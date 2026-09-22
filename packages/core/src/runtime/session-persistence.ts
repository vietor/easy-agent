import { mkdir, rename, writeFile } from "node:fs/promises";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Todo } from "../tools/types.js";
import { MAX_SUMMARY_LENGTH } from "../util/constants.js";
import { summarizeText } from "../util/text.js";
import type { SessionMessage } from "./session-messages.js";

const MAX_TITLE_SCAN_BYTES = 64 * 1024;
const SESSION_FILE_EXT = ".jsonl";

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

export interface SessionState {
  messages: SessionMessage[];
  todos: Todo[];
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

function parseRecords(text: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as SessionRecord); } catch { /* skip malformed lines */ }
  }
  return out;
}

function parseSessionFile(text: string): { state: SessionState; createdAt: number } {
  const messages: SessionMessage[] = [];
  let todos: Todo[] = [];
  let createdAt = 0;
  for (const r of parseRecords(text)) {
    if (r.t === "message" && r.m) {
      if (r.m.role === "system") continue;
      messages.push(r.m);
    } else if (r.t === "todo" && r.todos) {
      todos = r.todos;
    } else if (r.t === "session" && !createdAt && typeof r.createdAt === "number") {
      createdAt = r.createdAt;
    }
  }
  return { state: { messages, todos }, createdAt };
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

function headRecords(path: string): SessionRecord[] {
  try { return parseRecords(readFilePrefix(path, MAX_TITLE_SCAN_BYTES)); } catch { return []; }
}

function readHead(path: string): { createdAt?: number; title?: string } {
  let createdAt: number | undefined;
  for (const record of headRecords(path)) {
    if (record.t === "session" && typeof record.createdAt === "number") {
      createdAt ??= record.createdAt;
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
    if (!name.endsWith(SESSION_FILE_EXT)) continue;
    const path = join(dir, name);
    try {
      const stat = statSync(path);
      if (!stat.isFile()) continue;
      const head = readHead(path);
      out.push({
        id: basename(name, SESSION_FILE_EXT),
        title: head.title ? summarizeText(head.title, MAX_SUMMARY_LENGTH) : undefined,
        createdAt: head.createdAt ?? (stat.birthtimeMs || stat.mtimeMs),
        updatedAt: stat.mtimeMs,
      });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function sessionFileName(sessionId: string): string {
  return `${sessionId}${SESSION_FILE_EXT}`;
}

export function sessionFilePath(dir: string, sessionId: string): string {
  return join(dir, sessionFileName(sessionId));
}

export function notesFileName(id: string): string {
  return `${id}.notes.md`;
}

export function notesFilePath(dir: string, id: string): string {
  return join(dir, notesFileName(id));
}

export function isSessionExists(dir: string, sessionId: string): boolean {
  return existsSync(sessionFilePath(dir, sessionId));
}

function readSessionFile(path: string): { state: SessionState; createdAt: number; text: string } | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf-8");
  return { ...parseSessionFile(text), text };
}

export function loadSessionState(path: string): SessionState | null {
  return readSessionFile(path)?.state ?? null;
}

export function isSessionFile(path: string): boolean {
  return headRecords(path).some((r) => r.t === "session");
}

export class SessionPersistence {
  readonly path: string;
  private createdAt = 0;
  private last?: string;

  constructor(private dir: string, sessionId: string) {
    this.path = sessionFilePath(dir, sessionId);
  }

  load(): SessionState | null {
    const loaded = readSessionFile(this.path);
    if (!loaded) return null;
    this.createdAt = loaded.createdAt;
    this.last = loaded.text;
    return loaded.state;
  }

  async save(state: SessionState): Promise<void> {
    this.createdAt ||= Date.now();
    const lines = [
      toSessionLine(this.createdAt),
      ...state.messages.map((m) => toMessageLine(m)),
      toTodoLine(state.todos),
    ];
    const text = lines.join("\n") + "\n";
    if (text === this.last) return;
    await mkdir(this.dir, { recursive: true });
    const staged = `${this.path}.tmp`;
    await writeFile(staged, text, "utf-8");
    await rename(staged, this.path);
    this.last = text;
  }
}
