import { randomUUID } from "node:crypto";
import type { LLMClient } from "../llm/client.js";
import { parseToolArgs, textOf } from "../llm/types.js";
import { DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD } from "../util/constants.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerConfig, MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import { createAskUserTool } from "../tools/askUser.js";
import { createSkillTool } from "../tools/skill.js";
import { createTodoWriteTool } from "../tools/todoWrite.js";
import { createSubAgentTool } from "../tools/subAgent.js";
import { SessionBusyError, type SessionEvent, type SessionOptions, type SessionPersistence, type SessionState } from "./types.js";
import { Agent, type RunStatus } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { ListenerSet, TimelineStore, TodoStore, type TimelineEntry } from "./timeline.js";
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

  private pendingQuestions = new Map<string, (answer: string) => void>();
  private questionSeq = 0;
  private viewCache: SessionView | null = null;
  private eventListeners = new ListenerSet<(e: SessionEvent) => void>();
  private saveChain: Promise<void> = Promise.resolve();
  private latestUnansweredQuestion: Extract<TimelineEntry, { kind: "question" }> | undefined;

  subscribe = (listener: () => void): (() => void) => {
    const on = () => { this.viewCache = null; listener(); };
    const unsub1 = this.timelineStore.subscribe(on);
    const unsub2 = this.todoStore.subscribe(on);
    return () => { unsub1(); unsub2(); };
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
    this.timelineStore.append({ kind, text });
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

  dispose(): void {
    this.loop.abort();
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
    // Catch + chain: persistence failures must never block the agent loop.
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
    const toolResults = new Map<string, string>();
    const toolAnnotations = new Map<string, { preview?: string; isError?: boolean }>();
    for (const m of messages) {
      if (m.role === "tool") {
        toolResults.set(m.tool_call_id, m.content);
        if (m.preview !== undefined || m.isError !== undefined) {
          toolAnnotations.set(m.tool_call_id, { preview: m.preview, isError: m.isError });
        }
      }
    }
    for (const m of messages) {
      if (m.role === "user") {
        this.timelineStore.append({ kind: "user", text: m.content });
      } else if (m.role === "skill") {
        this.timelineStore.append({ kind: "skill", name: m.name });
      } else if (m.role === "assistant") {
        const text = textOf(m.content);
        if (text) this.timelineStore.append({ kind: "assistant", text });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            const { args } = parseToolArgs(tc.function.arguments);
            const ann = toolAnnotations.get(tc.id);
            this.timelineStore.append({
              kind: "tool",
              id: tc.id,
              name: tc.function.name,
              summary: this.tools.summarize(tc.function.name, args),
              result: toolResults.get(tc.id) ?? null,
              preview: ann?.preview,
              isError: ann?.isError,
            });
          }
        }
      }
    }
  }

  async compact(): Promise<RunStatus> {
    this.rejectIfBusy();
    await this.loop.startCompact();
    return this.loop.lastStatus;
  }

  abort(): void {
    this.loop.abort();
    for (const id of this.pendingQuestions.keys()) {
      this.timelineStore.setAnswer(id, "");
      this.emit({ type: "question_answered", id, answer: "" });
      this.pendingQuestions.get(id)?.("");
    }
    this.pendingQuestions.clear();
    this.latestUnansweredQuestion = undefined;
  }

  submitAnswer(id: string, answer: string): void {
    this.timelineStore.setAnswer(id, answer);
    if (this.latestUnansweredQuestion?.id === id) {
      this.latestUnansweredQuestion = undefined;
    }
    this.emit({ type: "question_answered", id, answer });
    const resolve = this.pendingQuestions.get(id);
    if (resolve) {
      this.pendingQuestions.delete(id);
      resolve(answer);
    }
  }

  async startPrompt(text: string): Promise<PromptResult> {
    this.rejectIfBusy();
    await this.loop.startPrompt(text);
    return { status: this.loop.lastStatus, reply: this.loop.lastReply };
  }

  private ask(text: string, options: string[]): Promise<string> {
    const id = `q${++this.questionSeq}`;
    const entry: Extract<TimelineEntry, { kind: "question" }> = { kind: "question", id, text, options, answer: null };
    this.timelineStore.append(entry);
    this.latestUnansweredQuestion = entry;
    this.emit({ type: "question", id, text, options });
    return new Promise<string>((resolve) => {
      this.pendingQuestions.set(id, resolve);
    });
  }
}
