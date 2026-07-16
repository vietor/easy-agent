import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConversationMessage, SessionMeta, SessionPersistence, SessionState, Todo } from "@vietor/easy-agent-core";

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\/\\:]/g, "-");
}

export class FileSessionPersistence implements SessionPersistence {
  private readonly dir: string;

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
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      let rec: unknown;
      try { rec = JSON.parse(line); } catch { continue; }
      const r = rec as { t?: string; m?: ConversationMessage; todos?: Todo[] };
      if (r.t === "m" && r.m) messages.push(r.m);
      else if (r.t === "todo" && r.todos) todos = r.todos;
    }
    return { messages, todos };
  }

  async saveAll(sessionId: string, state: SessionState): Promise<void> {
    this.ensureDir();
    const lines = state.messages
      .map((m) => JSON.stringify({ t: "m", m }))
      .concat([JSON.stringify({ t: "todo", todos: state.todos })]);
    writeFileSync(this.file(sessionId), lines.join("\n") + "\n", "utf-8");
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
  }

  private readTitle(path: string): string | undefined {
    const first = this.readFirstUser(path);
    if (!first) return undefined;
    const oneline = first.replace(/\s+/g, " ").trim();
    return oneline.length > 60 ? oneline.slice(0, 60) + "…" : oneline;
  }

  private readFirstUser(path: string): string | undefined {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      let rec: unknown;
      try { rec = JSON.parse(line); } catch { continue; }
      const r = rec as { t?: string; m?: ConversationMessage };
      if (r.t === "m" && r.m && r.m.role === "user" && typeof r.m.content === "string") return r.m.content;
    }
    return undefined;
  }
}
