import { randomUUID } from "node:crypto";
import type { LLMClient, LLMConfig } from "../llm/types.js";
import { isAbortError } from "../util/async.js";
import { toErrorMessage } from "../util/text.js";
import { DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD } from "../util/constants.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerConfig, MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { registerBuiltinTools, type BuiltinToolsOptions } from "../tools/builtins.js";
import type { Todo, Tool } from "../tools/types.js";
import { INITIAL_RUN_METRICS, type AgentEvent, type RunMetrics, type TimelineEvent } from "./events.js";
import type { SessionPersistence, SessionData } from "./persistence.js";
import type { ClientInfo } from "../mcp/types.js";
import { Agent, type RunStatus } from "./agent.js";
import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { Emitter } from "../util/emitter.js";
import { TimelineStore, toTimelineEntries } from "./timeline.js";
import { TodoStore } from "./todo-store.js";
import { createSubAgentRunner } from "./sub-agent-runner.js";
import { StreamBuffer } from "./stream-buffer.js";
import { QuestionQueue } from "./question-queue.js";
import { RunTimer } from "./run-timer.js";

export interface SessionOptions {
  systemPrompt: string;
  llm: LLMConfig;
  cwd?: string;
  tools?: Tool[];
  skills?: Skill[];
  mcpServers?: Record<string, MCPServerConfig>;
  builtInTools?: BuiltinToolsOptions | false;
  clientInfo?: ClientInfo;
  sessionId?: string;
  persistence?: SessionPersistence;
  maxTurns?: number;
  stallThreshold?: number;
}

export interface SessionDeps extends Omit<SessionOptions, "llm" | "tools" | "mcpServers"> {
  llm: LLMClient;
  tools: ToolRegistry;
  mcp: MCPServers;
  contextLimit: number;
}

export interface SessionView {
  timeline: readonly TimelineEvent[];
  todos: readonly Todo[];
}

export interface PromptResult {
  status: RunStatus;
  reply: string;
}

export class SessionBusyError extends Error {
  constructor() {
    super("session is busy; another run is in progress");
    this.name = "SessionBusyError";
  }
}

export class Session {
  private agent: Agent;
  private mcp: MCPServers;
  private skillsMap = new Map<string, Skill>();
  private resolveSkill = (name: string) => this.skillsMap.get(name);
  private timelineStore = new TimelineStore();
  private todoStore = new TodoStore();

  private stream = new StreamBuffer();
  private questionQueue = new QuestionQueue();
  private runTimer = new RunTimer();
  private runMetrics: RunMetrics = INITIAL_RUN_METRICS;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  private conversation: SessionMessages;
  private tools: ToolRegistry;
  readonly cwd: string;
  readonly sessionId: string;
  private persistence?: SessionPersistence;

  private viewCache: SessionView | null = null;
  private eventListeners = new Emitter<(e: AgentEvent) => void>();
  private saveChain: Promise<void> = Promise.resolve();

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

  onEvent = (listener: (e: AgentEvent) => void): (() => void) =>
    this.eventListeners.subscribe(listener);

  addNotice = (text: string): void => {
    this.emit({ type: "notice", text, persisted: true });
  };

  addError = (text: string): void => {
    this.emit({ type: "error", text, persisted: true });
  };

  runSkill = async (name: string): Promise<boolean> => {
    this.rejectIfBusy();
    const skill = this.skillsMap.get(name);
    if (!skill) return false;
    await this.start({ type: "skill", name: skill.name, persisted: true }, (signal) => this.agent.runSkill(skill, this.handleEvent, signal));
    return true;
  };

  private emit = (e: AgentEvent): void => {
    this.timelineStore.applyEvent(e);
    this.eventListeners.notify(e);
  };

  get pendingQuestion(): Extract<TimelineEvent, { type: "question" }> | undefined {
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

  get mcpServers(): readonly MCPServerInfo[] {
    return this.mcp.list();
  }

  get skills(): readonly Skill[] {
    return [...this.skillsMap.values()];
  }

  constructor(deps: SessionDeps) {
    this.conversation = new SessionMessages(deps.systemPrompt);
    this.tools = deps.tools;
    this.cwd = deps.cwd ?? process.cwd();
    this.sessionId = deps.sessionId ?? randomUUID();
    this.persistence = deps.persistence;
    for (const s of deps.skills ?? []) this.skillsMap.set(s.name, s);
    registerBuiltinTools(this.tools, deps.builtInTools, {
      ask: (q, o) => this.ask(q, o),
      setTodos: (t) => this.todoStore.set(t),
      resolveSkill: deps.skills?.length ? this.resolveSkill : undefined,
      subAgent: {
        runSubAgent: (systemPrompt, task, signal) =>
          createSubAgentRunner({
            llm: deps.llm,
            tools: this.tools,
            cwd: this.cwd,
            maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
            stallThreshold: deps.stallThreshold ?? DEFAULT_STALL_THRESHOLD,
            contextLimit: deps.contextLimit,
          })(systemPrompt, task, signal),
      },
    });

    this.agent = new Agent({
      llm: deps.llm,
      conversation: this.conversation,
      tools: this.tools,
      cwd: this.cwd,
      setTodos: (t) => this.todoStore.set(t),
      getTodos: () => this.todoStore.all,
      stallThreshold: deps.stallThreshold ?? DEFAULT_STALL_THRESHOLD,
      maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
      contextLimit: deps.contextLimit,
      resolveSkill: this.resolveSkill,
    });
    this.mcp = deps.mcp;
  }

  private start(event: AgentEvent, runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<PromptResult> {
    this.emit(event);
    return this.run(runFn);
  }

  private async run(runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<PromptResult> {
    this.stream.begin();
    this.runTimer.begin();
    this.abortController = new AbortController();
    this.runMetrics = { ...INITIAL_RUN_METRICS, running: true };
    this.agent.resetUsage();
    this.emitRunMetrics();

    this.timer = setInterval(() => {
      this.runMetrics = this.runTimer.metrics(this.agent.usage, this.stream.firstReplyAt, true);
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
        this.emit({ type: "error", text: toErrorMessage(e), persisted: true });
      }
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.timelineStore.markPendingToolsAborted();
      this.runMetrics = this.runTimer.metrics(this.agent.usage, this.stream.firstReplyAt, false);
      this.emitRunMetrics();
      this.flushThinking();
      this.clearCompletedTodos();
      this.persistSnapshot();
    }
    return { status, reply: this.stream.reply };
  }

  private clearCompletedTodos(): void {
    if (this.todoStore.all.length > 0 && this.todoStore.all.every((t) => t.status === "completed")) {
      this.todoStore.set([]);
    }
  }

  private emitRunMetrics(): void {
    this.emit({ type: "runMetrics", persisted: false, ...this.runMetrics });
  }

  private handleEvent = (e: AgentEvent): void => {
    switch (e.type) {
      case "assistantDelta":
        this.stream.push(e.text);
        break;
      case "thinkingDelta":
        this.stream.pushThinking(e.text);
        break;
      case "retry": {
        const { thinkingCleared } = this.stream.flushForRetry();
        if (thinkingCleared) this.emit({ type: "thinkingClear", persisted: false });
        break;
      }
      case "toolStart":
      case "error":
        this.flushStreaming();
        break;
      case "interrupted":
        if (this.stream.interrupt()) this.emit({ type: "thinkingClear", persisted: false });
        break;
    }
    this.emit(e);
  };

  private flushStreaming(): void {
    const { assistant, thinkingCleared } = this.stream.flush();
    if (assistant !== null) this.emit({ type: "assistant", text: assistant, persisted: true });
    if (thinkingCleared) this.emit({ type: "thinkingClear", persisted: false });
  }

  private flushThinking(): void {
    if (this.stream.flushThinking()) this.emit({ type: "thinkingClear", persisted: false });
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
    this.persistSnapshot();
  }

  private persistSnapshot(): void {
    if (!this.persistence) return;
    const state: SessionData = { messages: this.conversation.export(), todos: [...this.todoStore.all] };
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.persistence!.saveAll(this.sessionId, state));
  }

  flush(): Promise<void> {
    return this.saveChain;
  }

  export(): SessionMessage[] {
    return this.agent.export();
  }

  async restore(): Promise<boolean> {
    this.rejectIfBusy();
    if (!this.persistence) return false;
    const state = await this.persistence.load(this.sessionId);
    if (!state) return false;
    this.conversation.import(state.messages);
    this.todoStore.set(state.todos);
    this.timelineStore.rebuild(toTimelineEntries(this.conversation.export(), (n, a) => this.tools.summarizeArgs(n, a)));
    this.viewCache = null;
    return true;
  }

  async compact(): Promise<RunStatus> {
    this.rejectIfBusy();
    const { status } = await this.run((signal) => this.agent.compact(this.handleEvent, signal));
    return status;
  }

  abort(): void {
    this.abortController?.abort();
    for (const id of this.questionQueue.resolveAll("")) {
      this.timelineStore.setAnswer(id, "");
    }
  }

  submitAnswer(id: string, answer: string): void {
    this.questionQueue.submit(id, answer);
    this.timelineStore.setAnswer(id, answer);
  }

  async prompt(text: string): Promise<PromptResult> {
    this.rejectIfBusy();
    return this.start({ type: "user", text, persisted: true }, (signal) => this.agent.run(text, this.handleEvent, signal));
  }

  private ask(text: string, options: string[]): Promise<string> {
    const { id, promise } = this.questionQueue.ask();
    this.emit({ type: "question", id, text, options, answer: null, persisted: true });
    return promise;
  }
}
