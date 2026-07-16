import type { LLMClient } from "../llm/client.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import type { CommandRegistry } from "../cmds/registry.js";
import type { CommandSchema } from "../cmds/types.js";
import { Agent } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { TimelineStore, TodoStore, type TimelineEntry } from "./timeline.js";
import { RunLoop } from "./runloop.js";

export interface RunState {
  running: boolean;
  elapsed: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SessionView {
  timeline: readonly TimelineEntry[];
  todos: readonly Todo[];
}

export interface RunHandler {
  onStream?: (text: string) => void;
  onState?: (state: RunState) => void;
}

export interface SessionDeps {
  llm: LLMClient;
  systemPrompt: string;
  tools: ToolRegistry;
  commands: CommandRegistry;
  mcp: MCPServers;
  skills?: Skill[];
}

export class Session {
  private agent: Agent;
  private mcp: MCPServers;
  private commands: CommandRegistry;
  private timelineStore = new TimelineStore();
  private todoStore = new TodoStore();
  private loop: RunLoop;
  readonly localStore: Map<string, unknown> = new Map();

  private pendingQuestions = new Map<string, (answer: string) => void>();
  private questionSeq = 0;
  private viewCache: SessionView | null = null;

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

  getPendingQuestion(): Extract<TimelineEntry, { kind: "question" }> | undefined {
    return this.timelineStore.all.find(
      (e): e is Extract<TimelineEntry, { kind: "question" }> => e.kind === "question" && e.answer === null,
    );
  }

  get contextTokens(): number {
    return this.agent.contextTokens;
  }

  get mcpServers(): readonly MCPServerInfo[] {
    return this.mcp.list();
  }

  get commandSchemas(): CommandSchema[] {
    return this.commands.schemas();
  }

  constructor(deps: SessionDeps) {
    const conversation = new Conversation(deps.systemPrompt);
    this.agent = new Agent({
      llm: deps.llm,
      conversation,
      tools: deps.tools,
      ask: (q, o) => this.ask(q, o),
      setTodos: (t) => this.todoStore.set(t),
      getTodos: () => this.todoStore.all,
    });
    this.commands = deps.commands;
    this.mcp = deps.mcp;
    this.loop = new RunLoop(this.agent, this.timelineStore, this.todoStore);
    if (deps.skills) this.registerSkillCommands(deps.skills);
  }

  private registerSkillCommands(skills: Skill[]): void {
    for (const skill of skills) {
      this.commands.register({
        name: skill.name,
        description: skill.description ?? skill.name,
        execute: async () => { await this.loop.startSkill(skill); },
      });
    }
  }

  dispose(): void {
    this.loop.abort();
    this.mcp.kill();
  }

  setRunHandler(handler: RunHandler): void {
    this.loop.setRunHandler(handler);
  }

  clear(): void {
    this.agent.clear();
    this.timelineStore.clear();
    this.todoStore.set([]);
  }

  export(): ConversationMessage[] {
    return this.agent.export();
  }

  async compact(): Promise<void> {
    await this.loop.startCompact();
  }

  abort(): void {
    this.loop.abort();
    for (const id of this.pendingQuestions.keys()) {
      this.timelineStore.setAnswer(id, "");
      this.pendingQuestions.get(id)?.("");
    }
    this.pendingQuestions.clear();
  }

  submitAnswer(id: string, answer: string): void {
    this.timelineStore.setAnswer(id, answer);
    const resolve = this.pendingQuestions.get(id);
    if (resolve) {
      this.pendingQuestions.delete(id);
      resolve(answer);
    }
  }

  isCommand(name: string): boolean {
    return this.commands.exists(name);
  }

  async executeCommand(name: string, args = ""): Promise<void> {
    await this.commands.execute(
      name,
      {
        session: this,
        message: (t) => this.timelineStore.append({ kind: "system", text: t }),
        error: (t) => this.timelineStore.append({ kind: "error", text: t }),
      },
      args,
    );
  }

  async startPrompt(text: string): Promise<string> {
    await this.loop.startPrompt(text);
    return this.loop.lastReply;
  }

  private ask(text: string, options: string[]): Promise<string> {
    const id = `q${++this.questionSeq}`;
    this.timelineStore.append({ kind: "question", id, text, options, answer: null });
    return new Promise<string>((resolve) => {
      this.pendingQuestions.set(id, resolve);
    });
  }
}
