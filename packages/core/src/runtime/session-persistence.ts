import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import type { Todo } from "../tools/types.js";
import { MAX_SUMMARY_LENGTH } from "../util/constants.js";
import { summarizeText } from "../util/text.js";
import type { SessionMessage } from "./session-messages.js";
import type { SessionState } from "./session.js";

const MAX_TITLE_SCAN_BYTES = 64 * 1024;
const SESSION_HEADER_SCAN_BYTES = 256;

interface SessionRecord {
  t?: string;
  m?: SessionMessage;
  todos?: Todo[];
  createdAt?: number;
}

export interface SessionMeta {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

export function toSessionLine(createdAt: number): string {
  return JSON.stringify({ t: "session", createdAt });
}

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
  for (const r of parseJsonLines<SessionRecord>(text)) {
    if (r.t === "message" && r.m) {
      if (r.m.role === "system") continue;
      messages.push(r.m);
    } else if (r.t === "todo" && r.todos) todos = r.todos;
  }
  return { messages, todos };
}

function readFilePrefix(path: string, maxBytes: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const n = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, n).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

function readCreatedAt(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const record = JSON.parse(readFilePrefix(path, SESSION_HEADER_SCAN_BYTES).split("\n", 1)[0]) as SessionRecord;
    return record.t === "session" && typeof record.createdAt === "number" ? record.createdAt : 0;
  } catch {
    return 0;
  }
}

function readHead(path: string): { createdAt?: number; title?: string } {
  let createdAt: number | undefined;
  for (const line of readFilePrefix(path, MAX_TITLE_SCAN_BYTES).split("\n")) {
    if (!line.trim()) continue;
    let record: SessionRecord;
    try {
      record = JSON.parse(line) as SessionRecord;
    } catch {
      continue;
    }
    if (record.t === "session") {
      if (typeof record.createdAt === "number") createdAt = record.createdAt;
    } else if (record.t === "message" && record.m?.role === "user" && typeof record.m.content === "string") {
      return { createdAt, title: record.m.content };
    }
  }
  return { createdAt };
}

export function listSessions(dir: string): SessionMeta[] {
  if (!existsSync(dir)) return [];
  const out: SessionMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      const head = readHead(path);
      out.push({
        id: name.slice(0, -6),
        title: head.title ? summarizeText(head.title, MAX_SUMMARY_LENGTH) : undefined,
        createdAt: head.createdAt ?? (stat.birthtimeMs || stat.mtimeMs),
        updatedAt: stat.mtimeMs,
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function sessionFileName(sessionId: string): string {
  return `${sessionId}.jsonl`;
}

export function sessionFilePath(dir: string, sessionId: string): string {
  return join(dir, sessionFileName(sessionId));
}

export function loadSessionState(path: string): SessionState | null {
  if (!existsSync(path)) return null;
  return parseSessionState(readFileSync(path, "utf-8"));
}

export class SessionPersistence {
  readonly path: string;
  private written = 0;
  private revision = -1;
  private todos: SessionState["todos"] | undefined;
  private createdAt: number;

  constructor(private dir: string, sessionId: string) {
    this.path = sessionFilePath(dir, sessionId);
    this.createdAt = readCreatedAt(this.path);
  }

  seed(state: SessionState, revision: number): void {
    this.written = state.messages.length;
    this.revision = revision;
    this.todos = state.todos;
  }

  async save(state: SessionState, revision: number): Promise<void> {
    const messages = state.messages;
    const rewrite = revision !== this.revision;
    const lines = (rewrite ? messages : messages.slice(this.written)).map((m) => toMessageLine(m));
    if (rewrite) {
      this.createdAt ||= Date.now();
      lines.unshift(toSessionLine(this.createdAt));
    }
    if (rewrite || this.todos === undefined || !isDeepStrictEqual(this.todos, state.todos)) {
      lines.push(toTodoLine(state.todos));
    }
    if (lines.length === 0) return;
    await mkdir(this.dir, { recursive: true });
    if (rewrite) {
      const staged = `${this.path}.tmp`;
      await writeFile(staged, lines.join("\n") + "\n", "utf-8");
      await rename(staged, this.path);
    } else {
      await appendFile(this.path, lines.join("\n") + "\n", "utf-8");
    }
    this.written = messages.length;
    this.revision = revision;
    this.todos = state.todos;
  }
}
