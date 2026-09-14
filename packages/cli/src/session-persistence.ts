import { appendFile, rename, writeFile } from "node:fs/promises";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { type SessionMessage, type SessionState, type Todo } from "@vietor/agent-core";
import { MAX_SUMMARY_LENGTH, summarizeText } from "@vietor/agent-core/util";
import { parseJsonLines, parseSessionState, toMessageLine, toTodoLine } from "./session-format.js";

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

function lastMessageLine(messages: SessionMessage[]): string {
  const last = messages[messages.length - 1];
  return last ? toMessageLine(last) : "";
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
  private writtenTails = new Map<string, string>();

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
    const state = parseSessionState(readFileSync(path, "utf-8"));
    this.writtenCounts.set(sessionId, state.messages.length);
    this.writtenTodos.set(sessionId, state.todos);
    this.writtenTails.set(sessionId, lastMessageLine(state.messages));
    return state;
  }

  async loadFile(path: string): Promise<SessionState | null> {
    if (!existsSync(path)) return null;
    return parseSessionState(readFileSync(path, "utf-8"));
  }

  async saveAll(sessionId: string, state: SessionState): Promise<void> {
    this.ensureDir();
    const written = this.writtenCounts.get(sessionId) ?? 0;
    const tail = written > 0 && written <= state.messages.length ? toMessageLine(state.messages[written - 1]) : undefined;
    const rewrite = tail === undefined || tail !== this.writtenTails.get(sessionId);
    const lines = state.messages.slice(rewrite ? 0 : written).map((m) => toMessageLine(m));
    const lastTodos = this.writtenTodos.get(sessionId);
    if (rewrite || lastTodos === undefined || !isDeepStrictEqual(lastTodos, state.todos)) {
      lines.push(toTodoLine(state.todos));
    }
    if (lines.length === 0) return;
    const path = this.file(sessionId);
    if (rewrite) {
      const rewritten = `${path}.tmp`;
      await writeFile(rewritten, lines.join("\n") + "\n", "utf-8");
      await rename(rewritten, path);
    } else {
      await appendFile(path, lines.join("\n") + "\n", "utf-8");
    }
    this.writtenCounts.set(sessionId, state.messages.length);
    this.writtenTodos.set(sessionId, state.todos);
    this.writtenTails.set(sessionId, lastMessageLine(state.messages));
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
    return summarizeText(first, MAX_SUMMARY_LENGTH);
  }

  private readFirstUser(path: string): string | undefined {
    const first = parseJsonLines<{ t?: string; m?: SessionMessage }>(readFilePrefix(path, MAX_TITLE_SCAN_BYTES))
      .find((r) => r.t === "message" && r.m && r.m.role === "user" && typeof r.m.content === "string");
    return first?.m?.content as string | undefined;
  }
}
