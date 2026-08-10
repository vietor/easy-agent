import type { Todo } from "../tools/types.js";
import { parseToolArgs, textOf } from "../llm/types.js";
import type { ConversationMessage } from "./conversation.js";
import type { StreamEvent } from "./types.js";

/** Timeline entries are the persisted subset of StreamEvent with pending-state fields (tool result, question answer). */
type WithKind<T extends StreamEvent["type"], K extends string> =
  Omit<Extract<StreamEvent, { type: T }>, "type"> & { kind: K };

export type TimelineEntry =
  | WithKind<"user", "user">
  | WithKind<"skill", "skill">
  | WithKind<"assistant", "assistant">
  | (WithKind<"tool_start", "tool"> & { result: string | null; isError?: boolean; resultSummary?: string })
  | WithKind<"retry", "retry">
  | WithKind<"error", "error">
  | WithKind<"interrupted", "interrupted">
  | (WithKind<"question", "question"> & { answer: string | null })
  | WithKind<"notice", "notice">;

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

  applyEvent(e: StreamEvent): void {
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
        this.append({ kind: "tool", id: e.id, name: e.name, argsSummary: e.argsSummary, result: null });
        break;
      case "tool_end":
        this.setResult(e.id, e.result, e.isError, e.resultSummary);
        break;
      case "retry":
        this.append({ kind: "retry", attempt: e.attempt, max: e.max, reason: e.reason });
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

  setResult(id: string, result: string, isError?: boolean, resultSummary?: string): void {
    const idx = this.pendingTools.get(id);
    if (idx === undefined) return;
    this.pendingTools.delete(id);
    const entry = this.entries[idx];
    if (entry.kind !== "tool" || entry.result !== null) return;
    this.entries[idx] = { ...entry, result, isError, resultSummary };
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
  markPendingToolsAborted(): void {
    for (const [, idx] of this.pendingTools) {
      const entry = this.entries[idx];
      if (entry.kind === "tool" && entry.result === null) {
        this.entries[idx] = { ...entry, result: "aborted", isError: true, resultSummary: "aborted" };
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

  /** Replace all entries wholesale (session restore); unresolved tool entries are re-registered as pending. */
  rebuild(entries: TimelineEntry[]): void {
    this.entries = entries;
    this.pendingTools.clear();
    this.pendingQuestions.clear();
    entries.forEach((entry, i) => {
      if (entry.kind === "tool" && entry.result === null) {
        this.pendingTools.set(entry.id, i);
      }
    });
    this.listeners.notify();
  }
}

/** Replay persisted conversation messages as the timeline entries they represent (for session restore). */
export function messagesToTimelineEntries(
  messages: ConversationMessage[],
  summarizeArgs: (name: string, args: Record<string, unknown>) => string
): TimelineEntry[] {
  const toolResults = new Map<string, { content: string; resultSummary?: string; isError?: boolean }>();
  for (const m of messages) {
    if (m.role === "tool") {
      const result: { content: string; resultSummary?: string; isError?: boolean } = { content: m.content };
      if (m.resultSummary !== undefined || m.isError !== undefined) {
        result.resultSummary = m.resultSummary;
        result.isError = m.isError;
      }
      toolResults.set(m.tool_call_id, result);
    }
  }
  const entries: TimelineEntry[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      entries.push({ kind: "user", text: m.content });
    } else if (m.role === "skill") {
      entries.push({ kind: "skill", name: m.name });
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) entries.push({ kind: "assistant", text });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          const { args } = parseToolArgs(tc.function.arguments);
          const entry: TimelineEntry = {
            kind: "tool",
            id: tc.id,
            name: tc.function.name,
            argsSummary: summarizeArgs(tc.function.name, args),
            result: null,
          };
          const result = toolResults.get(tc.id);
          if (result) {
            // Same shape the live path produces on tool_end: result plus both pending fields.
            entries.push({ ...entry, result: result.content, isError: result.isError, resultSummary: result.resultSummary });
          } else {
            entries.push(entry);
          }
        }
      }
    }
  }
  return entries;
}
