import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ConversationMessage, SessionPersistence, SessionState, Todo } from "@vietor/easy-agent-core";

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\/\\:]/g, "-");
}

export class FileSessionPersistence implements SessionPersistence {
  private readonly dir: string;

  constructor(cwd: string) {
    this.dir = join(homedir(), ".easy-agent", "projects", encodeCwd(cwd));
  }

  private file(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`);
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  load(sessionId: string): SessionState | null {
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

  saveAll(sessionId: string, state: SessionState): void {
    this.ensureDir();
    const lines = state.messages
      .map((m) => JSON.stringify({ t: "m", m }))
      .concat([JSON.stringify({ t: "todo", todos: state.todos })]);
    writeFileSync(this.file(sessionId), lines.join("\n") + "\n", "utf-8");
  }

  listSessions(): { id: string; mtime: number }[] {
    if (!existsSync(this.dir)) return [];
    const out: { id: string; mtime: number }[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const id = name.slice(0, -6);
      try { out.push({ id, mtime: statSync(join(this.dir, name)).mtimeMs }); } catch {}
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }
}
