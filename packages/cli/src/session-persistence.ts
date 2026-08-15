import { appendFile, writeFile } from "node:fs/promises";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { type SessionMessage, type SessionState, type Todo } from "@vietor/agent-core";
import { summarizeText } from "@vietor/agent-core/util";

const MAX_TITLE_LENGTH = 75;
const MAX_TITLE_SCAN_BYTES = 64 * 1024;

export interface SessionMeta {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
}

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\/\\:]/g, "-");
}

function parseJsonLines<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* skip malformed lines */ }
  }
  return out;
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

export class FileSessionPersistence {
  private readonly dir: string;
  private writtenCounts = new Map<string, number>();
  private writtenTodos = new Map<string, Todo[]>();

  constructor(private cwd: string) {
    this.dir = join(homedir(), ".easy-agent", "projects", encodeCwd(cwd));
  }

  private file(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  async load(sessionId: string): Promise<SessionState | null> {
    const path = this.file(sessionId);
    if (!existsSync(path)) return null;
    const messages: SessionMessage[] = [];
    let todos: Todo[] = [];
    for (const r of parseJsonLines<{ t?: string; m?: SessionMessage; todos?: Todo[] }>(readFileSync(path, "utf-8"))) {
      if (r.t === "message" && r.m) messages.push(r.m);
      else if (r.t === "todo" && r.todos) todos = r.todos;
    }
    this.writtenCounts.set(sessionId, messages.length);
    this.writtenTodos.set(sessionId, todos);
    return { messages, todos };
  }

  async saveAll(sessionId: string, state: SessionState): Promise<void> {
    this.ensureDir();
    const written = this.writtenCounts.get(sessionId) ?? 0;
    const shrink = state.messages.length < written;
    const lines = state.messages
      .slice(shrink ? 0 : written)
      .map((m) => JSON.stringify({ t: "message", m }));
    const lastTodos = this.writtenTodos.get(sessionId);
    if (shrink || lastTodos === undefined || !isDeepStrictEqual(lastTodos, state.todos)) {
      lines.push(JSON.stringify({ t: "todo", todos: state.todos }));
    }
    if (lines.length === 0) return;
    const path = this.file(sessionId);
    if (shrink) {
      await writeFile(path, lines.join("\n") + "\n", "utf-8");
    } else {
      await appendFile(path, lines.join("\n") + "\n", "utf-8");
    }
    this.writtenCounts.set(sessionId, state.messages.length);
    this.writtenTodos.set(sessionId, state.todos);
  }

  async listSessions(): Promise<SessionMeta[]> {
    if (!existsSync(this.dir)) return [];
    const out: SessionMeta[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const id = name.slice(0, -6);
      const path = join(this.dir, name);
      try {
        const stat = statSync(path);
        out.push({
          id,
          title: this.readTitle(path),
          createdAt: stat.birthtimeMs || stat.mtimeMs,
          updatedAt: stat.mtimeMs,
          cwd: this.cwd,
        });
      } catch {}
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private readTitle(path: string): string | undefined {
    const first = this.readFirstUser(path);
    if (!first) return undefined;
    return summarizeText(first, MAX_TITLE_LENGTH);
  }

  private readFirstUser(path: string): string | undefined {
    const first = parseJsonLines<{ t?: string; m?: SessionMessage }>(readFilePrefix(path, MAX_TITLE_SCAN_BYTES))
      .find((r) => r.t === "message" && r.m && r.m.role === "user" && typeof r.m.content === "string");
    return first?.m?.content as string | undefined;
  }
}
