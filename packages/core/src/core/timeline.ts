import type { Todo } from "../tools/types.js";

export type TimelineEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean; preview?: string }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "question"; id: string; text: string; options: string[]; answer: string | null }
  | { kind: "notice"; text: string };

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

  append(entry: TimelineEntry): void {
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
    this.updatePending(
      this.pendingTools.get(id),
      () => this.pendingTools.delete(id),
      (e): e is Extract<TimelineEntry, { kind: "tool" }> => e.kind === "tool" && e.result === null,
      (e) => ({ ...e, result, isError, preview })
    );
  }

  setAnswer(id: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(id);
    const found = this.updatePending(
      pending?.index,
      () => this.pendingQuestions.delete(id),
      (e): e is Extract<TimelineEntry, { kind: "question" }> => e.kind === "question" && e.answer === null,
      (e) => ({ ...e, answer })
    );
    if (found) pending!.resolve(answer);
    return found;
  }

  pendingQuestionIds(): string[] {
    return [...this.pendingQuestions.keys()];
  }

  resolveAllAnswers(answer: string): string[] {
    const ids = this.pendingQuestionIds();
    for (const id of ids) this.setAnswer(id, answer);
    return ids;
  }

  private updatePending<T extends Extract<TimelineEntry, { kind: "tool" } | { kind: "question" }>>(
    idx: number | undefined,
    remove: () => void,
    isMatch: (e: TimelineEntry) => e is T,
    update: (e: T) => T
  ): boolean {
    if (idx === undefined) return false;
    remove();
    const entry = this.entries[idx];
    if (!isMatch(entry)) return false;
    this.entries[idx] = update(entry);
    this.listeners.notify();
    return true;
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
