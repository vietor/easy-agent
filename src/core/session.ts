import { withAbort } from "../util/async.js";
import type { LLMClient } from "../llm/client.js";
import type { MCPServers } from "../mcp/server.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { CommandRegistry } from "../cmds/registry.js";
import type { CommandSchema } from "../cmds/types.js";
import { Agent, type AgentEvent } from "./agent.js";
import { Conversation, type ConversationMessage } from "./conversation.js";

export type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "system"; text: string };

export interface SessionCallbacks {
  onStreaming?: (text: string) => void;
  onRunStateChange?: (running: boolean) => void;
  onElapsedChange?: (seconds: number) => void;
  onUsageChange?: (prompt: number, completion: number) => void;
}

export class Session {
  readonly conversation: Conversation;
  readonly agent: Agent;
  readonly mcp: MCPServers;
  private commands: CommandRegistry;

  private callbacks?: SessionCallbacks;
  private streamingText = "";
  private elapsed = 0;
  private usage = { prompt: 0, completion: 0 };
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startTime = 0;

  private logEntries: LogEntry[] = [];
  private logListeners = new Set<() => void>();

  getSnapshot = (): LogEntry[] => this.logEntries;

  subscribe = (listener: () => void): (() => void) => {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  };

  constructor(llm: LLMClient, systemPrompt: string, tools: ToolRegistry, commands: CommandRegistry, mcp: MCPServers) {
    this.conversation = new Conversation(systemPrompt);
    this.agent = new Agent(llm, this.conversation, tools);
    this.commands = commands;
    this.mcp = mcp;
    mcp.onError = (msg) => this.appendLog({ kind: "error", text: msg });
    for (const msg of mcp.flushErrors()) this.appendLog({ kind: "error", text: msg });
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

  appendLog(entry: LogEntry): void {
    this.logEntries = [...this.logEntries, entry];
    this.emitLog();
  }

  clearLog(): void {
    this.logEntries = [];
    this.emitLog();
  }

  clear(): void {
    this.agent.clear();
    this.clearLog();
  }

  export(): ConversationMessage[] {
    return this.agent.export();
  }

  async compact(): Promise<void> {
    await this.agent.compact();
  }

  abort(): void {
    this.abortController?.abort();
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
      clearLog: () => this.clearLog(),
      info: (t) => this.appendLog({ kind: "system", text: t }),
      error: (t) => this.appendLog({ kind: "error", text: t }),
      thinking: (on) => host.setRunning(on),
      runSkill: (s) => this.startSkill(s),
    });
  }

  async startPrompt(text: string): Promise<void> {
    this.appendLog({ kind: "user", text });
    await this.run((signal) => this.agent.run(text, this.makeHandler(), signal));
  }

  async startSkill(skill: Skill): Promise<void> {
    this.appendLog({ kind: "skill", name: skill.name });
    await this.run((signal) => this.agent.runSkill(skill, this.makeHandler(), signal));
  }

  private emitLog(): void {
    for (const listener of this.logListeners) listener();
  }

  private setToolResult(id: string, result: string, isError?: boolean): void {
    for (let i = this.logEntries.length - 1; i >= 0; i--) {
      const entry = this.logEntries[i];
      if (entry.kind === "tool" && entry.id === id && entry.result === null) {
        const copy = [...this.logEntries];
        copy[i] = { ...entry, result, isError };
        this.logEntries = copy;
        this.emitLog();
        return;
      }
    }
  }

  private async run(runFn: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.streamingText = "";
    this.elapsed = 0;
    this.usage = { prompt: 0, completion: 0 };
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
          this.setToolResult(e.id, e.result, e.isError);
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
          this.usage = { prompt: e.promptTokens, completion: e.completionTokens };
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
