import type { Todo } from "../tools/types.js";

export type TimelineEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "question"; id: string; text: string; options: string[]; answer: string | null }
  | { kind: "system"; text: string };

class VersionedStore {
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notify(): void {
    for (const l of this.listeners) l();
  }
}

export class TodoStore extends VersionedStore {
  private items: Todo[] = [];

  get all(): readonly Todo[] {
    return this.items;
  }

  set(todos: Todo[]): void {
    this.items = todos;
    this.notify();
  }
}

export class TimelineStore extends VersionedStore {
  private entries: TimelineEntry[] = [];
  private pendingTools = new Map<string, number>();
  private pendingQuestions = new Map<string, number>();

  get all(): readonly TimelineEntry[] {
    return this.entries;
  }

  append(entry: TimelineEntry): void {
    this.entries.push(entry);
    if (entry.kind === "tool" && entry.result === null) {
      this.pendingTools.set(entry.id, this.entries.length - 1);
    } else if (entry.kind === "question" && entry.answer === null) {
      this.pendingQuestions.set(entry.id, this.entries.length - 1);
    }
    this.notify();
  }

  setResult(id: string, result: string, isError?: boolean): void {
    const idx = this.pendingTools.get(id);
    if (idx === undefined) return;
    this.pendingTools.delete(id);
    const entry = this.entries[idx];
    if (entry.kind === "tool" && entry.result === null) {
      this.entries[idx] = { ...entry, result, isError };
      this.notify();
    }
  }

  setAnswer(id: string, answer: string): void {
    const idx = this.pendingQuestions.get(id);
    if (idx === undefined) return;
    this.pendingQuestions.delete(id);
    const entry = this.entries[idx];
    if (entry.kind === "question" && entry.answer === null) {
      this.entries[idx] = { ...entry, answer };
      this.notify();
    }
  }

  clear(): void {
    this.entries = [];
    this.pendingTools.clear();
    this.pendingQuestions.clear();
    this.notify();
  }
}
