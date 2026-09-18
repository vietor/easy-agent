import { randomUUID } from "node:crypto";
import type { LLMClient, LLMConfig } from "../llm/types.js";
import { isAbortError } from "../util/async.js";
import { cleanupSpoolDir } from "../util/spool.js";
import { toErrorMessage, trimLeftNewlines, trimSurroundingNewlines } from "../util/text.js";
import { DEFAULT_MAX_PARALLEL_TOOL_CALLS, DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD } from "../util/constants.js";
import { notesFileName } from "../util/file.js";
import type { MCPServerManager } from "../mcp/manager.js";
import type { MCPServerConfig, MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import { registerBuiltinTools, type BuiltinToolsOptions, type ToolRegistry } from "../tools/registry.js";
import type { Todo, Tool } from "../tools/types.js";
import type { AskAnswer, AskQuestion } from "../tools/ask-user.js";
import { INITIAL_RUN_METRICS, type RunMetrics, type SessionEvent, type TimelineEvent } from "./events.js";
import type { MCPClientInfo } from "../mcp/types.js";
import { Agent, type RunLimits, type RunStatus } from "./agent.js";
import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { SessionPersistence } from "./session-persistence.js";
import { Emitter } from "../util/emitter.js";
import { TimelineStore, toTimelineEntries } from "./timeline.js";
import { TodoStore } from "./todo-store.js";
import { runSubAgent } from "./sub-agent-runner.js";

class StreamBuffer {
  private streamingText = "";
  private thinkingText = "";
  private replyStart: number | null = null;
  private lastReplyText = "";

  get reply(): string {
    return this.lastReplyText;
  }

  get firstReplyAt(): number | null {
    return this.replyStart;
  }

  begin(): void {
    this.streamingText = "";
    this.thinkingText = "";
    this.replyStart = null;
    this.lastReplyText = "";
  }

  push(delta: string): string {
    if (this.replyStart === null) this.replyStart = Date.now();
    const text = this.streamingText ? delta : trimLeftNewlines(delta);
    if (text) this.streamingText += text;
    return text;
  }

  pushThinking(delta: string): string {
    const text = this.thinkingText ? delta : trimLeftNewlines(delta);
    if (text) this.thinkingText += text;
    return text;
  }

  interrupt(): boolean {
    this.lastReplyText = this.streamingText;
    this.streamingText = "";
    return this.flushThinking();
  }

  discardStreamedText(): void {
    this.streamingText = "";
  }

  flushThinking(): boolean {
    if (!this.thinkingText) return false;
    this.thinkingText = "";
    return true;
  }

  flushAssistant(): string | null {
    if (!this.streamingText) return null;
    this.lastReplyText = this.streamingText;
    const text = this.streamingText;
    this.streamingText = "";
    return text;
  }
}

class QuestionQueue {
  private questionSeq = 0;
  private resolvers = new Map<string, (answers: AskAnswer[]) => void>();

  ask(): { id: string; promise: Promise<AskAnswer[]> } {
    const id = `q${++this.questionSeq}`;
    const promise = new Promise<AskAnswer[]>((resolve) => {
      this.resolvers.set(id, resolve);
    });
    return { id, promise };
  }

  submit(id: string, answers: AskAnswer[]): void {
    const resolve = this.resolvers.get(id);
    if (resolve) {
      this.resolvers.delete(id);
      resolve(answers);
    }
  }

  resolveAll(): string[] {
    const ids = [...this.resolvers.keys()];
    for (const id of ids) {
      this.submit(id, []);
    }
    return ids;
  }
}

function runMetricsSince(
  startedAt: number,
  usage: { cacheInputTokens: number; missInputTokens: number; outputTokens: number },
  firstReplyAt: number | null,
  running: boolean
): RunMetrics {
  const now = Date.now();
  const elapsed = Math.floor((now - startedAt) / 1000);
  if (firstReplyAt === null) {
    return { running, elapsed, thinkingElapsed: elapsed, replyElapsed: 0, ...usage };
  }
  return {
    running,
    elapsed,
    thinkingElapsed: Math.floor((firstReplyAt - startedAt) / 1000),
    replyElapsed: Math.floor((now - firstReplyAt) / 1000),
    ...usage,
  };
}

export interface SessionOptions {
  systemPrompt: string;
  llm: LLMConfig;
  cwd?: string;
  tools?: Tool[];
  skills?: Skill[];
  mcpServers?: Record<string, MCPServerConfig>;
  builtInTools?: BuiltinToolsOptions | false;
  clientInfo?: MCPClientInfo;
  sessionId?: string;
  maxTurns?: number;
  stallThreshold?: number;
  maxParallelToolCalls?: number;
  toolSpoolDir?: string;
  sessionDir?: string;
}

export interface SessionDeps extends Omit<SessionOptions, "llm" | "tools" | "mcpServers"> {
  llm: LLMClient;
  tools: ToolRegistry;
  mcp: MCPServerManager;
  contextLimit: number;
}

export interface SessionView {
  timeline: readonly TimelineEvent[];
  todos: readonly Todo[];
}

export interface SessionState {
  messages: SessionMessage[];
  todos: Todo[];
}

export interface PromptResult {
  status: RunStatus;
  reply: string;
}

export type PendingQuestion = Extract<TimelineEvent, { type: "question" }>;

export class SessionBusyError extends Error {
  constructor() {
    super("session is busy; another run is in progress");
    this.name = "SessionBusyError";
  }
}

function requirePositiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer, got ${value}`);
  return value;
}

function resolveRunLimits(deps: SessionDeps): RunLimits {
  return {
    maxTurns: requirePositiveInt(deps.maxTurns ?? DEFAULT_MAX_TURNS, "maxTurns"),
    stallThreshold: requirePositiveInt(deps.stallThreshold ?? DEFAULT_STALL_THRESHOLD, "stallThreshold"),
    maxParallelToolCalls: requirePositiveInt(deps.maxParallelToolCalls ?? DEFAULT_MAX_PARALLEL_TOOL_CALLS, "maxParallelToolCalls"),
    contextLimit: deps.contextLimit,
    toolSpoolDir: deps.toolSpoolDir,
  };
}

export class Session {
  private agent: Agent;
  private mcp: MCPServerManager;
  private skillsMap = new Map<string, Skill>();
  private resolveSkill = (name: string) => this.skillsMap.get(name);
  private timelineStore = new TimelineStore();
  private todoStore = new TodoStore();

  private stream = new StreamBuffer();
  private questionQueue = new QuestionQueue();
  private runStartedAt = 0;
  private runMetrics: RunMetrics = INITIAL_RUN_METRICS;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  private conversation: SessionMessages;
  private tools: ToolRegistry;
  private limits: RunLimits;
  private persistence?: SessionPersistence;
  private saveChain: Promise<void> = Promise.resolve();
  readonly cwd: string;
  readonly sessionId: string;

  private viewCache: SessionView | null = null;
  private eventListeners = new Emitter<(e: SessionEvent) => void>();

  subscribe = (listener: () => void): (() => void) => {
    const on = () => { this.viewCache = null; listener(); };
    const unsubscribeTimeline = this.timelineStore.subscribe(on);
    const unsubscribeTodos = this.todoStore.subscribe(on);
    return () => { unsubscribeTimeline(); unsubscribeTodos(); };
  };

  getSnapshot = (): SessionView => {
    if (!this.viewCache) {
      this.viewCache = { timeline: this.timelineStore.all, todos: this.todoStore.all };
    }
    return this.viewCache;
  };

  onEvent = (listener: (e: SessionEvent) => void): (() => void) =>
    this.eventListeners.subscribe(listener);

  addNotice = (text: string): void => {
    this.emit({ type: "notice", text });
  };

  addError = (text: string): void => {
    this.emit({ type: "error", text });
  };

  runSkill = async (name: string): Promise<boolean> => {
    this.rejectIfBusy();
    const skill = this.resolveSkill(name);
    if (!skill) return false;
    await this.start({ type: "skill", name: skill.name }, (signal) => this.agent.runSkill(skill, this.handleEvent, signal));
    return true;
  };

  private emit = (e: SessionEvent): void => {
    this.timelineStore.applyEvent(e);
    this.eventListeners.notify(e);
  };

  get pendingQuestion(): PendingQuestion | undefined {
    return this.timelineStore.latestUnansweredQuestion;
  }

  get running(): boolean {
    return this.abortController !== null;
  }

  get contextTokens(): number {
    return this.agent.contextTokens;
  }

  get model() {
    return this.agent.model;
  }

  get thinkingEffort() {
    return this.agent.thinkingEffort;
  }

  get contextLimit() {
    return this.agent.contextLimit;
  }

  get filePath(): string | undefined {
    return this.persistence?.path;
  }

  get mcpServers(): readonly MCPServerInfo[] {
    return this.mcp.list();
  }

  get skills(): readonly Skill[] {
    return [...this.skillsMap.values()];
  }

  constructor(deps: SessionDeps) {
    this.limits = resolveRunLimits(deps);
    this.conversation = new SessionMessages(deps.systemPrompt);
    this.tools = deps.tools;
    this.cwd = deps.cwd ?? process.cwd();
    this.sessionId = deps.sessionId ?? randomUUID();
    this.persistence = deps.sessionDir ? new SessionPersistence(deps.sessionDir, this.sessionId) : undefined;
    for (const s of deps.skills ?? []) this.skillsMap.set(s.name, s);
    registerBuiltinTools(this.tools, deps.builtInTools, {
      ask: (questions) => this.ask(questions),
      setTodos: (t) => this.todoStore.set(t),
      resolveSkill: deps.skills?.length ? this.resolveSkill : undefined,
      subAgent: {
        runSubAgent: (systemPrompt, task, level, signal) =>
          runSubAgent({
            llm: deps.llm,
            tools: this.tools,
            cwd: this.cwd,
            ...this.limits,
            onUsage: (cacheInputTokens, missInputTokens, outputTokens) => this.agent.addUsage(cacheInputTokens, missInputTokens, outputTokens),
          }, systemPrompt, task, level, signal),
      },
    });

    this.agent = new Agent({
      llm: deps.llm,
      conversation: this.conversation,
      tools: this.tools,
      cwd: this.cwd,
      setTodos: (t) => this.todoStore.set(t),
      getTodos: () => this.todoStore.all,
      ...this.limits,
      resolveSkill: this.resolveSkill,
      onCompact: () => {
        this.stream.discardStreamedText();
        this.rebuildTimeline();
      },
    });
    this.mcp = deps.mcp;
  }

  private start(event: TimelineEvent, runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<PromptResult> {
    this.emit(event);
    return this.run(runFn);
  }

  private async run(runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<PromptResult> {
    this.stream.begin();
    this.runStartedAt = Date.now();
    this.abortController = new AbortController();
    this.runMetrics = { ...INITIAL_RUN_METRICS, running: true };
    this.agent.resetUsage();
    this.emitRunMetrics();

    this.timer = setInterval(() => {
      this.runMetrics = runMetricsSince(this.runStartedAt, this.agent.usage, this.stream.firstReplyAt, true);
      this.emitRunMetrics();
    }, 1000);

    let status: RunStatus = "ok";
    try {
      status = await runFn(this.abortController.signal);
      this.flushStreaming();
    } catch (e) {
      status = isAbortError(e) ? "aborted" : "error";
      this.flushStreaming();
      if (status !== "aborted") {
        this.emit({ type: "error", text: toErrorMessage(e) });
      }
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.timelineStore.markPendingToolsAborted();
      this.runMetrics = runMetricsSince(this.runStartedAt, this.agent.usage, this.stream.firstReplyAt, false);
      this.emitRunMetrics();
      this.flushThinking();
      this.clearCompletedTodos();
      if (this.limits.toolSpoolDir) void cleanupSpoolDir(this.limits.toolSpoolDir, notesFileName(this.sessionId));
      await this.save();
    }
    return { status, reply: this.stream.reply };
  }

  save(): Promise<void> {
    const persistence = this.persistence;
    if (!persistence) return Promise.resolve();
    const state = this.exportState();
    const revision = this.conversation.revision;
    this.saveChain = this.saveChain.then(() => persistence.save(state, revision)).catch((e) => {
      this.emit({ type: "error", text: `session save failed: ${toErrorMessage(e)}` });
    });
    return this.saveChain;
  }

  private clearCompletedTodos(): void {
    if (this.todoStore.all.length > 0 && this.todoStore.all.every((t) => t.status === "completed")) {
      this.todoStore.set([]);
    }
  }

  private emitRunMetrics(): void {
    this.emit({ type: "run_metrics", ...this.runMetrics });
  }

  private handleEvent = (e: SessionEvent): void => {
    let suppressed = false;
    switch (e.type) {
      case "assistant_delta": {
        e.text = this.stream.push(e.text);
        suppressed = !e.text;
        break;
      }
      case "thinking_delta": {
        e.text = this.stream.pushThinking(e.text);
        suppressed = !e.text;
        break;
      }
      case "retry": {
        this.stream.discardStreamedText();
        this.flushThinking();
        break;
      }
      case "tool_start":
      case "error":
        this.flushStreaming();
        break;
      case "interrupted":
        if (this.stream.interrupt()) this.emit({ type: "thinking_cleared" });
        break;
    }
    if (!suppressed) this.emit(e);
    if (e.type === "assistant_delta") this.flushThinking();
  };

  private flushStreaming(): void {
    const text = trimSurroundingNewlines(this.stream.flushAssistant());
    if (text) this.emit({ type: "assistant", text });
    this.flushThinking();
  }

  private flushThinking(): void {
    if (this.stream.flushThinking()) this.emit({ type: "thinking_cleared" });
  }

  async connectMCP(servers: Record<string, MCPServerConfig>): Promise<void> {
    await this.mcp.connect(servers);
  }

  dispose(): void {
    this.abort();
    this.mcp.kill();
  }

  private rejectIfBusy(): void {
    if (this.abortController !== null) throw new SessionBusyError();
  }

  clear(): void {
    this.rejectIfBusy();
    this.agent.clear();
    this.timelineStore.clear();
    this.todoStore.set([]);
    void this.save();
  }

  exportState(): SessionState {
    return { messages: this.conversation.export(), todos: [...this.todoStore.all] };
  }

  private rebuildTimeline(): void {
    this.timelineStore.rebuild(toTimelineEntries(this.conversation.export(), (n, a) => this.tools.summarizeArgs(n, a)));
    this.viewCache = null;
  }

  importState(state: SessionState): void {
    this.rejectIfBusy();
    this.conversation.import(state.messages);
    this.todoStore.set(state.todos);
    this.rebuildTimeline();
    this.persistence?.seed(this.exportState(), this.conversation.revision);
    void this.save();
  }

  async compact(): Promise<RunStatus> {
    this.rejectIfBusy();
    const { status } = await this.run((signal) => this.agent.compact(this.handleEvent, signal));
    return status;
  }

  abort(): void {
    this.abortController?.abort();
    for (const id of this.questionQueue.resolveAll()) this.submitAnswer(id, []);
  }

  submitAnswer(id: string, answers: AskAnswer[]): void {
    this.questionQueue.submit(id, answers);
    this.timelineStore.setAnswers(id, answers);
  }

  async prompt(text: string): Promise<PromptResult> {
    this.rejectIfBusy();
    return this.start({ type: "user", text }, (signal) => this.agent.run(text, this.handleEvent, signal));
  }

  private ask(questions: AskQuestion[]): Promise<AskAnswer[]> {
    const { id, promise } = this.questionQueue.ask();
    this.emit({ type: "question", id, questions: questions.map((q) => ({ ...q, answer: null })) });
    return promise;
  }
}
