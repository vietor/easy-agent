import type { Todo } from "../tools/types.js";
import { parseToolArgs, textOf } from "../llm/types.js";
import type { ConversationMessage } from "./conversation.js";
import type { StreamEvent } from "./types.js";

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
  private entries: StreamEvent[] = [];
  private pendingTools = new Map<string, number>();
  private pendingQuestions = new Map<string, { index: number; resolve: (a: string) => void }>();

  get all(): readonly StreamEvent[] {
    return this.entries;
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }

  applyEvent(e: StreamEvent): void {
    switch (e.type) {
      case "user":
      case "skill":
      case "assistant":
      case "retry":
      case "error":
      case "interrupted":
      case "notice":
        this.append(e);
        break;
      case "tool_start":
        this.append({ ...e, result: null });
        break;
      case "tool_end":
        this.setResult(e.id, e.result, e.isError, e.resultSummary);
        break;
      case "question":
      case "assistant_delta":
      case "reasoning_delta":
      case "reasoning_clear":
      case "run_state":
        break;
    }
  }

  private append(entry: StreamEvent): void {
    this.entries.push(entry);
    if (entry.type === "tool_start" && entry.result === null) {
      this.pendingTools.set(entry.id, this.entries.length - 1);
    }
    this.listeners.notify();
  }

  appendQuestion(entry: { id: string; text: string; options: string[] }, resolve: (a: string) => void): void {
    this.pendingQuestions.set(entry.id, { index: this.entries.length, resolve });
    this.entries.push({ type: "question", ...entry, answer: null });
    this.listeners.notify();
  }

  setResult(id: string, result: string, isError?: boolean, resultSummary?: string): void {
    const idx = this.pendingTools.get(id);
    if (idx === undefined) return;
    this.pendingTools.delete(id);
    const entry = this.entries[idx];
    if (entry.type !== "tool_start" || entry.result !== null) return;
    this.entries[idx] = { ...entry, result, isError, resultSummary };
    this.listeners.notify();
  }

  setAnswer(id: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(id);
    if (!pending) return false;
    this.pendingQuestions.delete(id);
    const entry = this.entries[pending.index];
    if (entry.type !== "question" || entry.answer !== null) return false;
    this.entries[pending.index] = { ...entry, answer };
    pending.resolve(answer);
    this.listeners.notify();
    return true;
  }

  pendingQuestionIds(): string[] {
    return [...this.pendingQuestions.keys()];
  }

  get latestUnansweredQuestion(): Extract<StreamEvent, { type: "question" }> | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.type === "question" && e.answer === null) return e;
    }
    return undefined;
  }

  markPendingToolsAborted(): void {
    for (const [, idx] of this.pendingTools) {
      const entry = this.entries[idx];
      if (entry.type === "tool_start" && entry.result === null) {
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

  rebuild(entries: StreamEvent[]): void {
    this.entries = entries;
    this.pendingTools.clear();
    this.pendingQuestions.clear();
    entries.forEach((entry, i) => {
      if (entry.type === "tool_start" && entry.result === null) {
        this.pendingTools.set(entry.id, i);
      }
    });
    this.listeners.notify();
  }
}

export function messagesToTimelineEntries(
  messages: ConversationMessage[],
  summarizeArgs: (name: string, args: Record<string, unknown>) => string
): StreamEvent[] {
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
  const entries: StreamEvent[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      entries.push({ type: "user", text: m.content });
    } else if (m.role === "skill") {
      entries.push({ type: "skill", name: m.name });
    } else if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) entries.push({ type: "assistant", text });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          const { args } = parseToolArgs(tc.function.arguments);
          const entry: StreamEvent = {
            type: "tool_start",
            id: tc.id,
            name: tc.function.name,
            argsSummary: summarizeArgs(tc.function.name, args),
            result: null,
          };
          const result = toolResults.get(tc.id);
          if (result) {
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
