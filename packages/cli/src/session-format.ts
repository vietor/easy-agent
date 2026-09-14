import { type SessionMessage, type SessionState, type Todo } from "@vietor/agent-core";

export function toMessageLine(m: SessionMessage): string {
  return JSON.stringify({ t: "message", m });
}

export function toTodoLine(todos: Todo[]): string {
  return JSON.stringify({ t: "todo", todos });
}

export function parseJsonLines<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* skip malformed lines */ }
  }
  return out;
}

export function parseSessionState(text: string): SessionState {
  const messages: SessionMessage[] = [];
  let todos: Todo[] = [];
  for (const r of parseJsonLines<{ t?: string; m?: SessionMessage; todos?: Todo[] }>(text)) {
    if (r.t === "message" && r.m) messages.push(r.m);
    else if (r.t === "todo" && r.todos) todos = r.todos;
  }
  return { messages, todos };
}
