import type { Agent, AgentEvent, RunStatus } from "./agent.js";
import type { Skill } from "../skills/types.js";
import type { TimelineStore, TodoStore } from "./timeline.js";
import { createInitialRunState, type SessionEvent, type RunState } from "./types.js";

export class RunLoop {
  private streamingText = "";
  private reasoningText = "";
  private replyStart: number | null = null;
  private lastReplyText = "";
  private lastStatusValue: RunStatus = "ok";
  private runState: RunState = createInitialRunState();
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
    await this.start({ type: "user", text }, (signal) => this.agent.run(text, this.handleEvent, signal));
  }

  async startSkill(skill: Skill): Promise<void> {
    await this.start({ type: "skill", name: skill.name }, (signal) => this.agent.runSkill(skill, this.handleEvent, signal));
  }

  async startCompact(): Promise<void> {
    await this.run((signal) => this.agent.compact(this.handleEvent, signal));
  }

  private async start(event: SessionEvent, runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<void> {
    this.timeline.applyEvent(event);
    this.emit(event);
    await this.run(runFn);
  }

  private async run(runFn: (signal: AbortSignal) => Promise<RunStatus>): Promise<void> {
    this.streamingText = "";
    this.reasoningText = "";
    this.replyStart = null;
    this.startTime = Date.now();
    this.abortController = new AbortController();
    this.runState = { ...createInitialRunState(), running: true };
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
      this.timeline.applyEvent({ type: "error", text: (e as Error).message });
      this.emit({ type: "error", text: (e as Error).message });
    } finally {
      clearInterval(this.timer);
      this.timer = undefined;
      this.abortController = null;
      this.lastStatusValue = status;
      if (status !== "ok") this.timeline.abortPendingTools();
      this.runState = { ...this.runState, ...this.computeTimings(), running: false };
      this.emitRunState();
      this.flushReasoning();
      this.clearCompletedTodos();
      this.onSettle?.();
    }
  }

  /** A fully completed task list is dead weight: drop it at input and at run settle so it never lingers across turns. */
  private clearCompletedTodos(): void {
    if (this.todos.all.length > 0 && this.todos.all.every((t) => t.status === "completed")) {
      this.todos.set([]);
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
      case "assistant_delta":
        if (this.replyStart === null) this.replyStart = Date.now();
        this.streamingText += e.text;
        break;
      case "reasoning_delta":
        this.reasoningText += e.text;
        break;
      case "retry":
      case "tool_start":
      case "error":
      case "interrupted":
        this.flushStreaming();
        break;
      case "usage":
        this.runState = { ...this.runState, inputTokens: e.inputTokens, outputTokens: e.outputTokens };
        this.emitRunState();
        return;
    }
    this.timeline.applyEvent(e);
    this.emit(e);
  };

  private flushStreaming(): void {
    if (this.streamingText) {
      this.lastReplyText = this.streamingText;
      const text = this.streamingText;
      this.timeline.applyEvent({ type: "assistant", text });
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
