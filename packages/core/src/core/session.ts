import { randomUUID } from "node:crypto";
import type { LLMClient } from "../llm/types.js";
import { isAbortError } from "../util/async.js";
import { errorMessage } from "../util/text.js";
import { DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD } from "../util/constants.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerConfig, MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import { registerBuiltinTools, type BuiltInToolsOptions, type ToolRegistry } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import { INITIAL_RUN_STATS, type RunStats, type StreamEvent, type TimelineEvent, type SessionPersistence, type SessionData } from "./types.js";
import type { ClientInfo } from "../util/types.js";
import { Agent, type RunStatus } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { ListenerSet, TimelineStore, TodoStore, messagesToTimelineEntries } from "./timeline.js";

export interface SessionDeps {
  systemPrompt: string;
  llm: LLMClient;
  cwd?: string;
  skills?: Skill[];
  tools: ToolRegistry;
  mcp: MCPServers;
  builtInTools?: BuiltInToolsOptions | false;
  clientInfo?: ClientInfo;
  sessionId?: string;
  persistence?: SessionPersistence;
  maxTurns?: number;
  stallThreshold?: number;
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
  readonly code = "SESSION_BUSY" as const;

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
  readonly localStore: Map<string, unknown> = new Map();

  private streamingText = "";
  private reasoningText = "";
  private replyStart: number | null = null;
  private lastReplyText = "";
  private runState: RunStats = INITIAL_RUN_STATS;
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startTime = 0;

  private conversation: Conversation;
  private tools: ToolRegistry;
  readonly cwd: string;
  readonly sessionId: string;
  private persistence?: SessionPersistence;

  private questionSeq = 0;
  private pendingQuestionResolvers = new Map<string, (answer: string) => void>();
  private viewCache: SessionView | null = null;
  private eventListeners = new ListenerSet<(e: StreamEvent) => void>();
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

  onEvent = (listener: (e: StreamEvent) => void): (() => void) =>
    this.eventListeners.subscribe(listener);

  addNotice = (text: string): void => {
    this.emit({ type: "notice", text });
  };

  addError = (text: string): void => {
    this.emit({ type: "error", text });
  };

  runSkill = async (name: string): Promise<boolean> => {
    this.rejectIfBusy();
    const skill = this.skillsMap.get(name);
    if (!skill) return false;
    await this.start({ type: "skill", name: skill.name }, (signal) => this.agent.runSkill(skill, this.handleEvent, signal));
    return true;
  };

  private emit = (e: StreamEvent): void => {
    this.timelineStore.applyEvent(e);
    this.eventListeners.notify(e);
  };

  get pendingQuestion(): Extract<StreamEvent, { type: "question" }> | undefined {
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

  get reasoningEffort() {
    return this.agent.reasoningEffort;
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
    this.conversation = new Conversation(deps.systemPrompt);
    this.tools = deps.tools;
    this.cwd = deps.cwd ?? process.cwd();
    this.sessionId = deps.sessionId ?? randomUUID();
    this.persistence = deps.persistence;
    for (const s of deps.skills ?? []) this.skillsMap.set(s.name, s);
    registerBuiltinTools(this.tools, deps.builtInTools, {
      ask: (q, o) => this.ask(q, o),
      setTodos: (t) => this.todoStore.set(t),
      resolveSkill: deps.skills?.length ? this.resolveSkill : undefined,
      subAgent: { llm: deps.llm, stallThreshold: deps.stallThreshold, maxTurns: deps.maxTurns, contextLimit: deps.contextLimit },
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

  private start(event: StreamEvent, runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<{ status: RunStatus; reply: string }> {
    this.emit(event);
    return this.run(runFn);
  }

  private async run(runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<{ status: RunStatus; reply: string }> {
    this.streamingText = "";
    this.lastReplyText = "";
    this.reasoningText = "";
    this.replyStart = null;
    this.startTime = Date.now();
    this.abortController = new AbortController();
    this.runState = { ...INITIAL_RUN_STATS, running: true };
    this.agent.resetUsage();
    this.emitRunState();

    this.timer = setInterval(() => {
      this.runState = { ...this.runState, ...this.computeTimings(), ...this.agent.usage };
      this.emitRunState();
    }, 1000);

    let status: RunStatus = "ok";
    try {
      status = await runFn(this.abortController.signal);
      this.flushStreaming();
    } catch (e) {
      status = isAbortError(e) ? "aborted" : "error";
      this.flushStreaming();
      if (status !== "aborted") {
        this.emit({ type: "error", text: errorMessage(e) });
      }
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.timelineStore.markPendingToolsAborted();
      this.runState = { ...this.runState, ...this.computeTimings(), running: false, ...this.agent.usage };
      this.emitRunState();
      this.flushReasoning();
      this.clearCompletedTodos();
      this.persistSnapshot();
    }
    return { status, reply: this.lastReplyText };
  }

  private clearCompletedTodos(): void {
    if (this.todoStore.all.length > 0 && this.todoStore.all.every((t) => t.status === "completed")) {
      this.todoStore.set([]);
    }
  }

  private computeTimings(): { elapsed: number; thinkingElapsed: number; replyElapsed: number } {
    const now = Date.now();
    const elapsed = Math.floor((now - this.startTime) / 1000);
    if (this.replyStart === null) {
      return { elapsed, thinkingElapsed: elapsed, replyElapsed: 0 };
    }
    return {
      elapsed,
      thinkingElapsed: Math.floor((this.replyStart - this.startTime) / 1000),
      replyElapsed: Math.floor((now - this.replyStart) / 1000),
    };
  }

  private emitRunState(): void {
    this.emit({ type: "run_state", ...this.runState });
  }

  private handleEvent = (e: StreamEvent): void => {
    switch (e.type) {
      case "assistant_delta":
        if (this.replyStart === null) this.replyStart = Date.now();
        this.streamingText += e.text;
        break;
      case "reasoning_delta":
        this.reasoningText += e.text;
        break;
      case "retry":
        this.streamingText = "";
        this.flushReasoning();
        break;
      case "tool_start":
      case "error":
        this.flushStreaming();
        break;
      case "interrupted":
        this.lastReplyText = this.streamingText;
        this.streamingText = "";
        this.flushReasoning();
        break;
    }
    this.emit(e);
  };

  private flushStreaming(): void {
    if (this.streamingText) {
      this.lastReplyText = this.streamingText;
      const text = this.streamingText;
      this.streamingText = "";
      this.emit({ type: "assistant", text });
    }
    this.flushReasoning();
  }

  private flushReasoning(): void {
    if (this.reasoningText) {
      this.reasoningText = "";
      this.emit({ type: "reasoning_clear" });
    }
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

  export(): ConversationMessage[] {
    return this.agent.export();
  }

  async restore(): Promise<boolean> {
    this.rejectIfBusy();
    if (!this.persistence) return false;
    const state = await this.persistence.load(this.sessionId);
    if (!state) return false;
    this.conversation.import(state.messages);
    this.todoStore.set(state.todos);
    this.timelineStore.rebuild(messagesToTimelineEntries(this.conversation.export(), (n, a) => this.tools.summarizeArgs(n, a)));
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
    this.resolvePendingQuestions("");
  }

  private resolvePendingQuestions(answer: string): void {
    for (const id of [...this.pendingQuestionResolvers.keys()]) {
      this.submitAnswer(id, answer);
    }
  }

  submitAnswer(id: string, answer: string): void {
    const resolve = this.pendingQuestionResolvers.get(id);
    if (resolve) {
      this.pendingQuestionResolvers.delete(id);
      resolve(answer);
    }
    this.timelineStore.setAnswer(id, answer);
  }

  async prompt(text: string): Promise<PromptResult> {
    this.rejectIfBusy();
    return this.start({ type: "user", text }, (signal) => this.agent.run(text, this.handleEvent, signal));
  }

  private ask(text: string, options: string[]): Promise<string> {
    const id = `q${++this.questionSeq}`;
    this.emit({ type: "question", id, text, options });
    return new Promise<string>((resolve) => {
      this.pendingQuestionResolvers.set(id, resolve);
      this.timelineStore.appendQuestion({ id, text, options });
    });
  }
}
