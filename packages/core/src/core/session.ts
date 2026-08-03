import { randomUUID } from "node:crypto";
import type { LLMClient } from "../llm/client.js";
import { DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD } from "../util/constants.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerConfig, MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import { createAskUserTool } from "../tools/ask-user.js";
import { createSkillTool } from "../tools/skill.js";
import { createTodoWriteTool } from "../tools/todo-write.js";
import { createSubAgentTool } from "../tools/sub-agent.js";
import { SessionBusyError, type SessionEvent, type SessionOptions, type SessionPersistence, type SessionState, type TimelineEntry } from "./types.js";
import { Agent, type RunStatus } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { ListenerSet, TimelineStore, TodoStore, messagesToSessionEvents } from "./timeline.js";
import { RunLoop } from "./runloop.js";

export interface SessionDeps extends Omit<SessionOptions, "tools"> {
  llm: LLMClient;
  tools: ToolRegistry;
  mcp: MCPServers;
  compactThreshold: number;
}

export interface SessionView {
  timeline: readonly TimelineEntry[];
  todos: readonly Todo[];
}

export interface PromptResult {
  status: RunStatus;
  reply: string;
}

export class Session {
  private agent: Agent;
  private mcp: MCPServers;
  private skillsMap = new Map<string, Skill>();
  private timelineStore = new TimelineStore();
  private todoStore = new TodoStore();
  private loop: RunLoop;
  readonly localStore: Map<string, unknown> = new Map();

  private conversation: Conversation;
  private tools: ToolRegistry;
  readonly cwd: string;
  readonly sessionId: string;
  private persistence?: SessionPersistence;

  private questionSeq = 0;
  private viewCache: SessionView | null = null;
  private eventListeners = new ListenerSet<(e: SessionEvent) => void>();
  private saveChain: Promise<void> = Promise.resolve();
  private latestUnansweredQuestion: Extract<TimelineEntry, { kind: "question" }> | undefined;

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

  subscribeEvents = (listener: (e: SessionEvent) => void): (() => void) =>
    this.eventListeners.subscribe(listener);

  timelineNotice = (text: string): void => {
    this.timelineAppend("notice", text);
  };

  timelineError = (text: string): void => {
    this.timelineAppend("error", text);
  };

  runSkill = async (name: string): Promise<boolean> => {
    this.rejectIfBusy();
    const skill = this.skillsMap.get(name);
    if (!skill) return false;
    await this.loop.startSkill(skill);
    return true;
  };

  private timelineAppend(kind: "notice" | "error", text: string): void {
    this.timelineStore.applyEvent({ type: kind, text });
    this.emit({ type: kind, text });
  }

  private emit = (e: SessionEvent): void => {
    this.eventListeners.notify(e);
  };

  getPendingQuestion(): Extract<TimelineEntry, { kind: "question" }> | undefined {
    return this.latestUnansweredQuestion;
  }

  get running(): boolean {
    return this.loop.running;
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

  get compactThreshold() {
    return this.agent.compactThreshold;
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
    const builtinTools = deps.builtinTools === false ? undefined : deps.builtinTools;
    if (builtinTools?.askUser) {
      this.tools.register(createAskUserTool((q, o) => this.ask(q, o)));
    }
    if (builtinTools?.todoWrite) {
      this.tools.register(createTodoWriteTool((t) => this.todoStore.set(t)));
    }
    if (builtinTools?.skill) {
      this.tools.register(createSkillTool((name) => this.skillsMap.get(name)));
    }
    if (builtinTools?.subAgent) {
      this.tools.register(createSubAgentTool({
        llm: deps.llm,
        tools: this.tools,
        stallThreshold: deps.stallThreshold,
        maxTurns: deps.maxTurns,
        compactThreshold: deps.compactThreshold,
      }));
    }

    this.agent = new Agent({
      llm: deps.llm,
      conversation: this.conversation,
      tools: this.tools,
      cwd: this.cwd,
      setTodos: (t) => this.todoStore.set(t),
      getTodos: () => this.todoStore.all,
      stallThreshold: deps.stallThreshold ?? DEFAULT_STALL_THRESHOLD,
      maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
      compactThreshold: deps.compactThreshold,
      resolveSkill: (name) => this.skillsMap.get(name),
    });
    this.mcp = deps.mcp;
    this.loop = new RunLoop(this.agent, this.timelineStore, this.todoStore, this.emit);
    this.loop.onSettle = () => this.persistSnapshot();
    this.latestUnansweredQuestion = undefined;
  }

  async connectMCP(servers: Record<string, MCPServerConfig>): Promise<void> {
    await this.mcp.connect(servers);
  }

  async reconnectMCP(name: string): Promise<void> {
    await this.mcp.reconnect(name);
  }

  dispose(): void {
    this.loop.abort();
    this.resolvePendingQuestions("");
    this.mcp.kill();
  }

  private rejectIfBusy(): void {
    if (this.loop.running) throw new SessionBusyError();
  }

  clear(): void {
    this.rejectIfBusy();
    this.agent.clear();
    this.timelineStore.clear();
    this.todoStore.set([]);
    this.latestUnansweredQuestion = undefined;
    this.persistSnapshot();
  }

  private persistSnapshot(): void {
    if (!this.persistence) return;
    const state: SessionState = { messages: this.conversation.export(), todos: [...this.todoStore.all] };
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
    this.timelineStore.clear();
    this.rebuildTimeline(state.messages);
    this.viewCache = null;
    this.latestUnansweredQuestion = undefined;
    return true;
  }

  private rebuildTimeline(messages: ConversationMessage[]): void {
    for (const e of messagesToSessionEvents(messages, (n, a) => this.tools.summarize(n, a))) {
      this.timelineStore.applyEvent(e);
    }
  }

  async compact(): Promise<RunStatus> {
    this.rejectIfBusy();
    await this.loop.startCompact();
    return this.loop.lastStatus;
  }

  abort(): void {
    this.loop.abort();
    this.resolvePendingQuestions("");
  }

  private resolvePendingQuestions(answer: string): void {
    const ids = this.timelineStore.resolveAllAnswers(answer);
    for (const id of ids) {
      this.emit({ type: "question_answered", id, answer });
    }
    this.latestUnansweredQuestion = undefined;
  }

  submitAnswer(id: string, answer: string): void {
    this.timelineStore.setAnswer(id, answer);
    this.emit({ type: "question_answered", id, answer });
  }

  async startPrompt(text: string): Promise<PromptResult> {
    this.rejectIfBusy();
    await this.loop.startPrompt(text);
    return { status: this.loop.lastStatus, reply: this.loop.lastReply };
  }

  private ask(text: string, options: string[]): Promise<string> {
    const id = `q${++this.questionSeq}`;
    this.latestUnansweredQuestion = { kind: "question", id, text, options, answer: null };
    this.emit({ type: "question", id, text, options });
    return new Promise<string>((resolve) => {
      this.timelineStore.appendQuestion({ id, text, options }, (answer) => {
        if (this.latestUnansweredQuestion?.id === id) {
          this.latestUnansweredQuestion = undefined;
        }
        resolve(answer);
      });
    });
  }
}
