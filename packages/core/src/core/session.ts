import { withAbort } from "../util/async.js";
import type { LLMClient } from "../llm/client.js";
import type { MCPServers } from "../mcp/server.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Todo } from "../tools/types.js";
import type { CommandRegistry } from "../cmds/registry.js";
import type { CommandSchema } from "../cmds/types.js";
import { Agent, type AgentEvent } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { LogStore, type LogEntry } from "./logstore.js";

export interface SessionCallbacks {
  onStreaming?: (text: string) => void;
  onRunStateChange?: (running: boolean) => void;
  onElapsedChange?: (seconds: number) => void;
  onUsageChange?: (prompt: number, completion: number) => void;
}

export class Session {
  private agent: Agent;
  private mcp: MCPServers;
  private commands: CommandRegistry;
  private log = new LogStore();

  private callbacks?: SessionCallbacks;
  private streamingText = "";
  private elapsed = 0;
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

  constructor(llm: LLMClient, systemPrompt: string, tools: ToolRegistry, commands: CommandRegistry, mcp: MCPServers) {
    const conversation = new Conversation(systemPrompt);
    this.agent = new Agent(llm, conversation, tools, (q, o) => this.ask(q, o), (t) => this.log.setTodos(t), () => this.log.getTodos());
    this.commands = commands;
    this.mcp = mcp;
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
    try {
      await this.agent.compact(ctrl.signal);
      return true;
    } catch (e) {
      if (ctrl.signal.aborted) return false;
      throw e;
    } finally {
      this.abortController = null;
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

  ask(text: string, options: string[]): Promise<string> {
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

  async executeCommand(name: string, host: { exit: () => void; setRunning: (on: boolean) => void }): Promise<void> {
    await this.commands.execute(name, { session: this, mcp: this.mcp }, {
      exit: host.exit,
      info: (t) => this.appendLog({ kind: "system", text: t }),
      error: (t) => this.appendLog({ kind: "error", text: t }),
      thinking: (on) => host.setRunning(on),
      runSkill: (s) => this.startSkill(s),
    });
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
    this.elapsed = 0;
    this.startTime = Date.now();
    this.abortController = new AbortController();
    this.callbacks?.onElapsedChange?.(0);
    this.callbacks?.onUsageChange?.(0, 0);
    this.callbacks?.onRunStateChange?.(true);

    this.timer = setInterval(() => {
      this.elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      this.callbacks?.onElapsedChange?.(this.elapsed);
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
      this.callbacks?.onRunStateChange?.(false);
    }
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
          this.callbacks?.onUsageChange?.(e.promptTokens, e.completionTokens);
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
