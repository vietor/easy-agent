import type { Todo } from "../tools/types.js";

export type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "question"; id: string; text: string; options: string[]; answer: string | null }
  | { kind: "system"; text: string };

export class LogStore {
  private entries: LogEntry[] = [];
  private todos: Todo[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private pendingTools = new Map<string, number>();
  private pendingQuestions = new Map<string, number>();

  getSnapshot = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get all(): readonly LogEntry[] {
    return this.entries;
  }

  getTodos(): readonly Todo[] {
    return this.todos;
  }

  setTodos(todos: Todo[]): void {
    this.todos = todos;
    this.version++;
    this.emit();
  }

  append(entry: LogEntry): void {
    this.entries.push(entry);
    if (entry.kind === "tool" && entry.result === null) {
      this.pendingTools.set(entry.id, this.entries.length - 1);
    } else if (entry.kind === "question" && entry.answer === null) {
      this.pendingQuestions.set(entry.id, this.entries.length - 1);
    }
    this.version++;
    this.emit();
  }

  setResult(id: string, result: string, isError?: boolean): void {
    const idx = this.pendingTools.get(id);
    if (idx === undefined) return;
    this.pendingTools.delete(id);
    const entry = this.entries[idx];
    if (entry.kind === "tool" && entry.result === null) {
      this.entries[idx] = { ...entry, result, isError };
      this.version++;
      this.emit();
    }
  }

  setAnswer(id: string, answer: string): void {
    const idx = this.pendingQuestions.get(id);
    if (idx === undefined) return;
    this.pendingQuestions.delete(id);
    const entry = this.entries[idx];
    if (entry.kind === "question" && entry.answer === null) {
      this.entries[idx] = { ...entry, answer };
      this.version++;
      this.emit();
    }
  }

  clear(): void {
    this.entries = [];
    this.todos = [];
    this.pendingTools.clear();
    this.pendingQuestions.clear();
    this.version++;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
