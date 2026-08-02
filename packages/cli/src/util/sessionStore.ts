import { appendFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ellipsisText } from "@vietor/easy-agent-core";
import type { ConversationMessage, SessionMeta, SessionPersistence, SessionState, Todo } from "@vietor/easy-agent-core";

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

export class FileSessionPersistence implements SessionPersistence {
  private readonly dir: string;
  private writtenCounts = new Map<string, number>();

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
    const messages: ConversationMessage[] = [];
    let todos: Todo[] = [];
    for (const r of parseJsonLines<{ t?: string; m?: ConversationMessage; todos?: Todo[] }>(readFileSync(path, "utf-8"))) {
      if (r.t === "m" && r.m) messages.push(r.m);
      else if (r.t === "todo" && r.todos) todos = r.todos;
    }
    this.writtenCounts.set(sessionId, messages.length);
    return { messages, todos };
  }

  async saveAll(sessionId: string, state: SessionState): Promise<void> {
    this.ensureDir();
    const written = this.writtenCounts.get(sessionId) ?? 0;
    const shrink = state.messages.length < written;
    const lines = state.messages
      // on shrink (abort restore / compact) rewrite everything, not just the tail
      .slice(shrink ? 0 : written)
      .map((m) => JSON.stringify({ t: "m", m }))
      .concat([JSON.stringify({ t: "todo", todos: state.todos })]);
    const path = this.file(sessionId);
    if (shrink) {
      await writeFile(path, lines.join("\n") + "\n", "utf-8");
    } else {
      await appendFile(path, lines.join("\n") + "\n", "utf-8");
    }
    this.writtenCounts.set(sessionId, state.messages.length);
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

  async delete(sessionId: string): Promise<void> {
    const path = this.file(sessionId);
    if (existsSync(path)) unlinkSync(path);
    this.writtenCounts.delete(sessionId);
  }

  private readTitle(path: string): string | undefined {
    const first = this.readFirstUser(path);
    if (!first) return undefined;
    return ellipsisText(first, 75);
  }

  private readFirstUser(path: string): string | undefined {
    for (const r of parseJsonLines<{ t?: string; m?: ConversationMessage }>(readFileSync(path, "utf-8"))) {
      if (r.t === "m" && r.m && r.m.role === "user" && typeof r.m.content === "string") return r.m.content;
    }
    return undefined;
  }
}
