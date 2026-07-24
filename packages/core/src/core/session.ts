import { randomUUID } from "node:crypto";
import type { LLMClient } from "../llm/client.js";
import type { AssistantMessage } from "../llm/types.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import { SkillRegistry } from "../skills/registry.js";
import type { ToolRegistry, BuiltinToolsOptions } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import { createAskUserTool } from "../tools/askUser.js";
import { createTodoWriteTool } from "../tools/todoWrite.js";
import type { CommandRegistry } from "../cmds/registry.js";
import type { CommandSchema } from "../cmds/types.js";
import { SessionBusyError, type SessionPersistence, type SessionState } from "./types.js";
import { Agent, type RunStatus } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { TimelineStore, TodoStore, type TimelineEntry } from "./timeline.js";
import { RunLoop } from "./runloop.js";

export interface RunState {
  running: boolean;
  elapsed: number;
  thinkingElapsed: number;
  replyElapsed: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SessionView {
  timeline: readonly TimelineEntry[];
  todos: readonly Todo[];
}

export interface PromptResult {
  status: RunStatus;
  reply: string;
}

export type SessionEvent =
  | { type: "user"; text: string }
  | { type: "skill"; name: string }
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "reasoning_clear" }
  | { type: "assistant"; text: string }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean }
  | { type: "retry"; attempt: number; max: number }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; text: string; options: string[] }
  | { type: "question_answered"; id: string; answer: string }
  | { type: "system"; text: string }
  | { type: "state"; running: boolean; elapsed: number; thinkingElapsed: number; replyElapsed: number; inputTokens: number; outputTokens: number };

export interface SessionDeps {
  llm: LLMClient;
  systemPrompt: string;
  cwd: string;
  tools: ToolRegistry;
  commands: CommandRegistry;
  mcp: MCPServers;
  skills?: Skill[];
  builtinTools?: BuiltinToolsOptions;
  sessionId?: string;
  persistence?: SessionPersistence;
  stallThreshold?: number;
  maxTurns?: number;
  compactThreshold?: number;
}

export class Session {
  private agent: Agent;
  private mcp: MCPServers;
  private commands: CommandRegistry;
  private skills: SkillRegistry;
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
  private eventListeners = new Set<(e: SessionEvent) => void>();
  private saveChain: Promise<void> = Promise.resolve();

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

  subscribeEvents = (listener: (e: SessionEvent) => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  };

  private emit = (e: SessionEvent): void => {
    for (const l of [...this.eventListeners]) {
      try { l(e); } catch {}
    }
  };

  getPendingQuestion(): Extract<TimelineEntry, { kind: "question" }> | undefined {
    return this.timelineStore.all.find(
      (e): e is Extract<TimelineEntry, { kind: "question" }> => e.kind === "question" && e.answer === null,
    );
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

  get commandSchemas(): CommandSchema[] {
    const map = new Map<string, CommandSchema>();
    for (const c of this.commands.schemas()) map.set(c.name, c);
    for (const s of this.skills.schemas()) if (!map.has(s.name)) map.set(s.name, s);
    return [...map.values()];
  }

  constructor(deps: SessionDeps) {
    this.conversation = new Conversation(deps.systemPrompt);
    this.tools = deps.tools;
    this.cwd = deps.cwd;
    this.sessionId = deps.sessionId ?? randomUUID();
    this.persistence = deps.persistence;
    if (deps.builtinTools?.askUser) {
      deps.tools.register(createAskUserTool((q, o) => this.ask(q, o)));
    }
    if (deps.builtinTools?.todoWrite) {
      deps.tools.register(createTodoWriteTool((t) => this.todoStore.set(t)));
    }

    this.agent = new Agent({
      llm: deps.llm,
      conversation: this.conversation,
      tools: deps.tools,
      cwd: deps.cwd,
      setTodos: (t) => this.todoStore.set(t),
      getTodos: () => this.todoStore.all,
      stallThreshold: deps.stallThreshold,
      maxTurns: deps.maxTurns,
      compactThreshold: deps.compactThreshold,
    });
    this.commands = deps.commands;
    this.mcp = deps.mcp;
    this.loop = new RunLoop(this.agent, this.timelineStore, this.todoStore, this.emit);
    this.loop.onSettle = () => this.persistSnapshot();
    this.skills = new SkillRegistry(deps.skills ?? []);
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

  async restore(): Promise<void> {
    this.rejectIfBusy();
    if (!this.persistence) return;
    const state = await this.persistence.load(this.sessionId);
    if (!state) return;
    this.conversation.import(state.messages);
    this.todoStore.set(state.todos);
    this.rebuildTimeline(state.messages);
    this.viewCache = null;
  }

  private rebuildTimeline(messages: ConversationMessage[]): void {
    const toolResults = new Map<string, string>();
    for (const m of messages) {
      if (m.role === "tool") toolResults.set(m.tool_call_id, m.content);
    }
    for (const m of messages) {
      if (m.role === "user") {
        this.timelineStore.append({ kind: "user", text: m.content });
      } else if (m.role === "skill") {
        this.timelineStore.append({ kind: "skill", name: m.name });
      } else if (m.role === "assistant") {
        const text = assistantText(m);
        if (text) this.timelineStore.append({ kind: "assistant", text });
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            let args: Record<string, unknown> = {};
            if (tc.function.arguments) {
              try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
            }
            this.timelineStore.append({
              kind: "tool",
              id: tc.id,
              name: tc.function.name,
              summary: this.tools.summarize(tc.function.name, args),
              result: toolResults.get(tc.id) ?? null,
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
  }

  submitAnswer(id: string, answer: string): void {
    this.timelineStore.setAnswer(id, answer);
    this.emit({ type: "question_answered", id, answer });
    const resolve = this.pendingQuestions.get(id);
    if (resolve) {
      this.pendingQuestions.delete(id);
      resolve(answer);
    }
  }

  async executeCommand(name: string, args = ""): Promise<void> {
    this.rejectIfBusy();
    if (!this.commands.exists(name)) {
      const skill = this.skills.get(name);
      if (skill) {
        await this.loop.startSkill(skill);
        return;
      }
    }
    await this.commands.execute(
      name,
      {
        session: this,
        message: (t) => { this.timelineStore.append({ kind: "system", text: t }); this.emit({ type: "system", text: t }); },
        error: (t) => { this.timelineStore.append({ kind: "error", text: t }); this.emit({ type: "error", text: t }); },
      },
      args,
    );
  }

  async startPrompt(text: string): Promise<PromptResult> {
    this.rejectIfBusy();
    await this.loop.startPrompt(text);
    return { status: this.loop.lastStatus, reply: this.loop.lastReply };
  }

  private ask(text: string, options: string[]): Promise<string> {
    const id = `q${++this.questionSeq}`;
    this.timelineStore.append({ kind: "question", id, text, options, answer: null });
    this.emit({ type: "question", id, text, options });
    return new Promise<string>((resolve) => {
      this.pendingQuestions.set(id, resolve);
    });
  }
}

function assistantText(m: AssistantMessage): string {
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.filter((p) => p.type === "text").map((p) => p.text).join("");
  return "";
}
