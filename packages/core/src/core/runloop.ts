import type { Agent, AgentEvent } from "./agent.js";
import type { Skill } from "../skills/types.js";
import type { TimelineStore, TodoStore } from "./timeline.js";
import type { RunHandler, RunState } from "./session.js";

export class RunLoop {
  private streamingText = "";
  private lastReplyText = "";
  private runState: RunState = { running: false, elapsed: 0, promptTokens: 0, completionTokens: 0 };
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startTime = 0;
  private handler?: RunHandler;
  onSettle?: () => void;

  constructor(
    private agent: Agent,
    private timeline: TimelineStore,
    private todos: TodoStore
  ) {}

  setRunHandler(handler: RunHandler): void {
    this.handler = handler;
  }

  get lastReply(): string {
    return this.lastReplyText;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async startPrompt(text: string): Promise<void> {
    if (this.todos.all.length > 0 && this.todos.all.every((t) => t.status === "completed")) {
      this.todos.set([]);
    }
    this.timeline.append({ kind: "user", text });
    await this.run((signal) => this.agent.run(text, this.handleEvent, signal));
  }

  async startSkill(skill: Skill): Promise<void> {
    this.timeline.append({ kind: "skill", name: skill.name });
    await this.run((signal) => this.agent.runSkill(skill, this.handleEvent, signal));
  }

  async startCompact(): Promise<void> {
    await this.run((signal) => this.agent.compact(this.handleEvent, signal));
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
      this.timeline.append({ kind: "error", text: (e as Error).message });
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.runState = { ...this.runState, running: false };
      this.emitRunState();
      this.onSettle?.();
    }
  }

  private emitRunState(): void {
    this.handler?.onState?.(this.runState);
  }

  private handleEvent = (e: AgentEvent): void => {
    switch (e.type) {
      case "delta":
        this.streamingText += e.text;
        this.handler?.onStream?.(this.streamingText);
        break;
      case "tool_start":
        this.flushStreaming();
        this.timeline.append({ kind: "tool", id: e.id, name: e.name, summary: e.summary, result: null });
        break;
      case "retry":
        this.streamingText = "";
        this.timeline.append({ kind: "retry", attempt: e.attempt, max: e.max });
        break;
      case "tool_end":
        this.timeline.setResult(e.id, e.result, e.isError);
        break;
      case "error":
        this.flushStreaming();
        this.timeline.append({ kind: "error", text: e.text });
        break;
      case "interrupted":
        this.flushStreaming();
        this.timeline.append({ kind: "interrupted" });
        break;
      case "usage":
        this.runState = { ...this.runState, promptTokens: e.promptTokens, completionTokens: e.completionTokens };
        this.emitRunState();
        break;
    }
  };

  private flushStreaming(): void {
    if (this.streamingText) {
      this.lastReplyText = this.streamingText;
      this.timeline.append({ kind: "assistant", text: this.streamingText });
      this.streamingText = "";
      this.handler?.onStream?.("");
    }
  }
}
