import { withAbort } from "../util/async.js";
import type { LLMClient } from "../llm/client.js";
import type { MCPServers } from "../mcp/server.js";
import type { MCPServerInfo } from "../mcp/types.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import type { CommandRegistry } from "../cmds/registry.js";
import type { CommandSchema } from "../cmds/types.js";
import { Agent, type AgentEvent } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { LogStore, type LogEntry } from "./logstore.js";

export interface RunState {
  running: boolean;
  elapsed: number;
  promptTokens: number;
  completionTokens: number;
}

export interface SessionCallbacks {
  onStreaming?: (text: string) => void;
  onRunStateChange?: (state: RunState) => void;
}

export class Session {
  private agent: Agent;
  private mcp: MCPServers;
  private commands: CommandRegistry;
  readonly host: Map<string, unknown>;
  private log = new LogStore();

  private callbacks?: SessionCallbacks;
  private streamingText = "";
  private runState: RunState = { running: false, elapsed: 0, promptTokens: 0, completionTokens: 0 };
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startTime = 0;
  private pendingQuestions = new Map<string, (answer: string) => void>();
  private questionSeq = 0;

  getSnapshot = (): number => this.log.getSnapshot();

  subscribe = (listener: () => void): (() => void) => this.log.subscribe(listener);

  get logEntries(): readonly LogEntry[] {
    return this.log.all;
  }

  get todos(): readonly Todo[] {
    return this.log.getTodos();
  }

  constructor(llm: LLMClient, systemPrompt: string, tools: ToolRegistry, commands: CommandRegistry, mcp: MCPServers, host: Map<string, unknown>) {
    const conversation = new Conversation(systemPrompt);
    this.agent = new Agent(llm, conversation, tools, (q, o) => this.ask(q, o), (t) => this.log.setTodos(t), () => this.log.getTodos());
    this.commands = commands;
    this.mcp = mcp;
    this.host = host;
  }

  dispose(): void {
    this.mcp.kill();
  }

  setCallbacks(cb: SessionCallbacks): void {
    this.callbacks = cb;
  }

  get contextTokens(): number {
    return this.agent.contextTokens;
  }

  get mcpServers(): readonly MCPServerInfo[] {
    return this.mcp.list();
  }

  private appendLog(entry: LogEntry): void {
    this.log.append(entry);
  }

  private clearLog(): void {
    this.log.clear();
  }

  clear(): void {
    this.agent.clear();
    this.clearLog();
  }

  export(): ConversationMessage[] {
    return this.agent.export();
  }

  async compact(): Promise<boolean> {
    const ctrl = new AbortController();
    this.abortController = ctrl;
    this.setRunning(true);
    try {
      await this.agent.compact(ctrl.signal);
      return true;
    } catch (e) {
      if (ctrl.signal.aborted) return false;
      throw e;
    } finally {
      this.abortController = null;
      this.setRunning(false);
    }
  }

  abort(): void {
    this.abortController?.abort();
    for (const id of this.pendingQuestions.keys()) {
      this.log.setAnswer(id, "");
      this.pendingQuestions.get(id)?.("");
    }
    this.pendingQuestions.clear();
  }

  private ask(text: string, options: string[]): Promise<string> {
    const id = `q${++this.questionSeq}`;
    this.appendLog({ kind: "question", id, text, options, answer: null });
    return new Promise<string>((resolve) => {
      this.pendingQuestions.set(id, resolve);
    });
  }

  submitAnswer(id: string, answer: string): void {
    this.log.setAnswer(id, answer);
    const resolve = this.pendingQuestions.get(id);
    if (resolve) {
      this.pendingQuestions.delete(id);
      resolve(answer);
    }
  }

  get commandSchemas(): CommandSchema[] {
    return this.commands.schemas();
  }

  isCommand(name: string): boolean {
    return this.commands.exists(name);
  }

  async executeCommand(name: string, args = ""): Promise<void> {
    await this.commands.execute(
      name,
      {
        session: this,
        host: this.host,
        message: (t) => this.appendLog({ kind: "system", text: t }),
        error: (t) => this.appendLog({ kind: "error", text: t }),
      },
      args,
    );
  }

  async startPrompt(text: string): Promise<void> {
    if (this.todos.length > 0 && this.todos.every((t) => t.status === "completed")) {
      this.log.setTodos([]);
    }
    this.appendLog({ kind: "user", text });
    await this.run((signal) => this.agent.run(text, this.makeHandler(), signal));
  }

  async startSkill(skill: Skill): Promise<void> {
    this.appendLog({ kind: "skill", name: skill.name });
    await this.run((signal) => this.agent.runSkill(skill, this.makeHandler(), signal));
  }

  private async run(runFn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.streamingText = "";
    this.startTime = Date.now();
    this.abortController = new AbortController();
    this.runState = { running: true, elapsed: 0, promptTokens: 0, completionTokens: 0 };
    this.emitRunState();

    this.timer = setInterval(() => {
      this.runState = { ...this.runState, elapsed: Math.floor((Date.now() - this.startTime) / 1000) };
      this.emitRunState();
    }, 1000);

    try {
      await runFn(this.abortController.signal);
      this.flushStreaming();
    } catch (e) {
      this.flushStreaming();
      this.appendLog({ kind: "error", text: (e as Error).message });
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.setRunning(false);
    }
  }

  private setRunning(running: boolean): void {
    this.runState = { ...this.runState, running };
    this.emitRunState();
  }

  private emitRunState(): void {
    this.callbacks?.onRunStateChange?.(this.runState);
  }

  private makeHandler(): (e: AgentEvent) => void {
    return (e: AgentEvent) => {
      switch (e.type) {
        case "delta":
          this.streamingText += e.text;
          this.callbacks?.onStreaming?.(this.streamingText);
          break;
        case "tool_start":
          this.flushStreaming();
          this.appendLog({ kind: "tool", id: e.id, name: e.name, summary: e.summary, result: null });
          break;
        case "retry":
          this.streamingText = "";
          this.appendLog({ kind: "retry", attempt: e.attempt, max: e.max });
          break;
        case "tool_end":
          this.log.setResult(e.id, e.result, e.isError);
          break;
        case "error":
          this.flushStreaming();
          this.appendLog({ kind: "error", text: e.text });
          break;
        case "interrupted":
          this.flushStreaming();
          this.appendLog({ kind: "interrupted" });
          break;
        case "usage":
          this.runState = { ...this.runState, promptTokens: e.promptTokens, completionTokens: e.completionTokens };
          this.emitRunState();
          break;
      }
    };
  }

  private flushStreaming(): void {
    if (this.streamingText) {
      this.appendLog({ kind: "assistant", text: this.streamingText });
      this.streamingText = "";
      this.callbacks?.onStreaming?.("");
    }
  }
}
