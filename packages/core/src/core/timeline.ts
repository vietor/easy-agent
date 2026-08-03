import type { Todo } from "../tools/types.js";
import { parseToolArgs, textOf } from "../llm/types.js";
import type { ConversationMessage } from "./conversation.js";
import type { SessionEvent, TimelineEntry } from "./types.js";

export class ListenerSet<T extends (...args: any[]) => void = () => void> {
  private listeners = new Set<T>();

  subscribe(listener: T): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(...args: Parameters<T>): void {
    for (const l of this.listeners) {
      try { l(...args); } catch { /* isolate listener errors */ }
    }
  }
}

export class TodoStore {
  private listeners = new ListenerSet();
  private items: Todo[] = [];

  get all(): readonly Todo[] {
    return this.items;
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }

  set(todos: Todo[]): void {
    this.items = todos;
    this.listeners.notify();
  }
}

export class TimelineStore {
  private listeners = new ListenerSet();
  private entries: TimelineEntry[] = [];
  private pendingTools = new Map<string, number>();
  private pendingQuestions = new Map<string, { index: number; resolve: (a: string) => void }>();

  get all(): readonly TimelineEntry[] {
    return this.entries;
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }

  /** The single event -> timeline translation: how every SessionEvent becomes an entry. */
  applyEvent(e: SessionEvent): void {
    switch (e.type) {
      case "user":
        this.append({ kind: "user", text: e.text });
        break;
      case "skill":
        this.append({ kind: "skill", name: e.name });
        break;
      case "assistant":
        this.append({ kind: "assistant", text: e.text });
        break;
      case "tool_start":
        this.append({ kind: "tool", id: e.id, name: e.name, summary: e.summary, result: null });
        break;
      case "tool_end":
        this.setResult(e.id, e.result, e.isError, e.preview);
        break;
      case "retry":
        this.append({ kind: "retry", attempt: e.attempt, max: e.max });
        break;
      case "error":
        this.append({ kind: "error", text: e.text });
        break;
      case "interrupted":
        this.append({ kind: "interrupted" });
        break;
      case "notice":
        this.append({ kind: "notice", text: e.text });
        break;
      case "question":
      case "question_answered":
      case "assistant_delta":
      case "reasoning_delta":
      case "reasoning_clear":
      case "state":
        break;
    }
  }

  private append(entry: TimelineEntry): void {
    this.entries.push(entry);
    if (entry.kind === "tool" && entry.result === null) {
      this.pendingTools.set(entry.id, this.entries.length - 1);
    }
    this.listeners.notify();
  }

  appendQuestion(entry: { id: string; text: string; options: string[] }, resolve: (a: string) => void): void {
    this.pendingQuestions.set(entry.id, { index: this.entries.length, resolve });
    this.entries.push({ kind: "question", ...entry, answer: null });
    this.listeners.notify();
  }

  setResult(id: string, result: string, isError?: boolean, preview?: string): void {
    const idx = this.pendingTools.get(id);
    if (idx === undefined) return;
    this.pendingTools.delete(id);
    const entry = this.entries[idx];
    if (entry.kind !== "tool" || entry.result !== null) return;
    this.entries[idx] = { ...entry, result, isError, preview };
    this.listeners.notify();
  }

  setAnswer(id: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(id);
    if (!pending) return false;
    this.pendingQuestions.delete(id);
    const entry = this.entries[pending.index];
    if (entry.kind !== "question" || entry.answer !== null) return false;
    this.entries[pending.index] = { ...entry, answer };
    pending.resolve(answer);
    this.listeners.notify();
    return true;
  }

  pendingQuestionIds(): string[] {
    return [...this.pendingQuestions.keys()];
  }

  /** The most recent question entry still awaiting an answer. */
  get latestUnansweredQuestion(): Extract<TimelineEntry, { kind: "question" }> | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.kind === "question" && e.answer === null) return e;
    }
    return undefined;
  }

  /** Resolve any tool entries still marked as running (e.g. the run was aborted before tool_end). */
  abortPendingTools(): void {
    for (const [, idx] of this.pendingTools) {
      const entry = this.entries[idx];
      if (entry.kind === "tool" && entry.result === null) {
        this.entries[idx] = { ...entry, result: "aborted", isError: true, preview: "aborted" };
      }
    }
    this.pendingTools.clear();
    this.listeners.notify();
  }

  clear(): void {
    this.entries = [];
    this.pendingTools.clear();
    this.pendingQuestions.clear();
    this.listeners.notify();
  }
}

/** Replay persisted conversation messages as the events that produced them (for session restore). */
export function messagesToSessionEvents(
  messages: ConversationMessage[],
  summarize: (name: string, args: Record<string, unknown>) => string
): SessionEvent[] {
  const toolResults = new Map<string, { content: string; preview?: string; isError?: boolean }>();
  for (const m of messages) {
    if (m.role === "tool") {
      const result: { content: string; preview?: string; isError?: boolean } = { content: m.content };
      if (m.preview !== undefined || m.isError !== undefined) {
        result.preview = m.preview;
        result.isError = m.isError;
      }
      toolResults.set(m.tool_call_id, result);
    }
  }
  const events: SessionEvent[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      events.push({ type: "user", text: m.content });
    } else if (m.role === "skill") {
      events.push({ type: "skill", name: m.name });
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) events.push({ type: "assistant", text });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          const { args } = parseToolArgs(tc.function.arguments);
          events.push({ type: "tool_start", id: tc.id, name: tc.function.name, summary: summarize(tc.function.name, args) });
          const result = toolResults.get(tc.id);
          if (result) {
            events.push({ type: "tool_end", id: tc.id, result: result.content, isError: result.isError, preview: result.preview });
          }
        }
      }
    }
  }
  return events;
}
