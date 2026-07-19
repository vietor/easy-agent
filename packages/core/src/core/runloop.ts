import type { Agent, AgentEvent, RunStatus } from "./agent.js";
import type { Skill } from "../skills/types.js";
import type { TimelineStore, TodoStore } from "./timeline.js";
import type { SessionEvent, RunState } from "./session.js";

export class RunLoop {
  private streamingText = "";
  private reasoningText = "";
  private replyStart: number | null = null;
  private lastReplyText = "";
  private lastStatusValue: RunStatus = "ok";
  private runState: RunState = { running: false, elapsed: 0, promptTokens: 0, completionTokens: 0, thinkingElapsed: 0, replyElapsed: 0 };
  private abortController: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private startTime = 0;
  onSettle?: () => void;

  constructor(
    private agent: Agent,
    private timeline: TimelineStore,
    private todos: TodoStore,
    private emit: (e: SessionEvent) => void
  ) {}

  get lastReply(): string {
    return this.lastReplyText;
  }

  get lastStatus(): RunStatus {
    return this.lastStatusValue;
  }

  get running(): boolean {
    return this.abortController !== null;
  }

  abort(): void {
    this.abortController?.abort();
  }

  async startPrompt(text: string): Promise<void> {
    if (this.todos.all.length > 0 && this.todos.all.every((t) => t.status === "completed")) {
      this.todos.set([]);
    }
    this.timeline.append({ kind: "user", text });
    this.emit({ type: "user", text });
    await this.run((signal) => this.agent.run(text, this.handleEvent, signal));
  }

  async startSkill(skill: Skill): Promise<void> {
    this.timeline.append({ kind: "skill", name: skill.name });
    this.emit({ type: "skill", name: skill.name });
    await this.run((signal) => this.agent.runSkill(skill, this.handleEvent, signal));
  }

  async startCompact(): Promise<void> {
    await this.run((signal) => this.agent.compact(this.handleEvent, signal));
  }

  private async run(runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<void> {
    this.streamingText = "";
    this.reasoningText = "";
    this.replyStart = null;
    this.startTime = Date.now();
    this.abortController = new AbortController();
    this.runState = { running: true, elapsed: 0, promptTokens: 0, completionTokens: 0, thinkingElapsed: 0, replyElapsed: 0 };
    this.lastStatusValue = "ok";
    this.emitRunState();

    this.timer = setInterval(() => {
      this.runState = { ...this.runState, ...this.computeTimings() };
      this.emitRunState();
    }, 1000);

    let status: RunStatus = "ok";
    try {
      status = await runFn(this.abortController.signal);
      this.flushStreaming();
    } catch (e) {
      status = "error";
      this.flushStreaming();
      this.timeline.append({ kind: "error", text: (e as Error).message });
      this.emit({ type: "error", text: (e as Error).message });
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.lastStatusValue = status;
      this.runState = { ...this.runState, ...this.computeTimings(), running: false };
      this.emitRunState();
      this.flushReasoning();
      this.onSettle?.();
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
    this.emit({ type: "state", ...this.runState });
  }

  private handleEvent = (e: AgentEvent): void => {
    switch (e.type) {
      case "delta":
        if (this.replyStart === null) this.replyStart = Date.now();
        this.streamingText += e.text;
        this.emit({ type: "assistant_delta", text: e.text });
        break;
      case "reasoning_delta":
        this.reasoningText += e.text;
        this.emit({ type: "reasoning_delta", text: e.text });
        break;
      case "tool_start":
        this.flushStreaming();
        this.timeline.append({ kind: "tool", id: e.id, name: e.name, summary: e.summary, result: null });
        this.emit({ type: "tool_start", id: e.id, name: e.name, summary: e.summary });
        break;
      case "retry":
        this.streamingText = "";
        this.flushReasoning();
        this.timeline.append({ kind: "retry", attempt: e.attempt, max: e.max });
        this.emit({ type: "retry", attempt: e.attempt, max: e.max });
        break;
      case "tool_end":
        this.timeline.setResult(e.id, e.result, e.isError);
        this.emit({ type: "tool_end", id: e.id, result: e.result, isError: e.isError });
        break;
      case "error":
        this.flushStreaming();
        this.timeline.append({ kind: "error", text: e.text });
        this.emit({ type: "error", text: e.text });
        break;
      case "interrupted":
        this.flushStreaming();
        this.timeline.append({ kind: "interrupted" });
        this.emit({ type: "interrupted" });
        break;
      case "system":
        this.timeline.append({ kind: "system", text: e.text });
        this.emit({ type: "system", text: e.text });
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
      const text = this.streamingText;
      this.timeline.append({ kind: "assistant", text });
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
}
