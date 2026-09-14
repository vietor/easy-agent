import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { type SessionState } from "@vietor/agent-core";
import type { FileSessionPersistence } from "./session-persistence.js";

export interface CliOptions {
  continue?: boolean;
  resume?: string | boolean;
  import?: string;
}

export interface ResolvedSession {
  sessionId: string;
  resume: boolean;
  imported: SessionState | null;
}

export async function listSessions(store: FileSessionPersistence, name: string): Promise<void> {
  const sessions = await store.listSessions();
  if (!sessions.length) {
    console.log("No previous sessions found in this directory.");
    return;
  }
  console.log("Previous sessions (most recent first):");
  for (const s of sessions) {
    const title = s.title ? `  ${s.title}` : "";
    console.log(`  ${s.id}  ${new Date(s.updatedAt).toLocaleString()}${title}`);
  }
  console.log(`\nResume with: ${name} --resume <id>`);
}

export async function resolveSession(store: FileSessionPersistence, opts: CliOptions): Promise<ResolvedSession> {
  let sessionId: string | undefined;
  let resume = false;
  let imported: SessionState | null = null;
  if (opts.import) {
    const path = resolve(opts.import);
    imported = await store.loadFile(path);
    if (!imported) {
      console.error(`Import file not found: ${path}`);
      process.exit(1);
    }
    if (!imported.messages.length) {
      console.error(`No session messages found in: ${path}`);
      process.exit(1);
    }
    sessionId = basename(path, ".jsonl");
  } else if (opts.continue) {
    const sessions = await store.listSessions();
    if (sessions.length) {
      sessionId = sessions[0].id;
      resume = true;
    }
  } else if (opts.resume && typeof opts.resume === "string") {
    sessionId = opts.resume;
    resume = true;
  }
  if (!sessionId) sessionId = randomUUID();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
    console.error(`Invalid session id: ${sessionId}`);
    process.exit(1);
  }
  if (imported && (await store.load(sessionId))) {
    console.error(`Session already exists: ${sessionId} (use --resume ${sessionId})`);
    process.exit(1);
  }
  return { sessionId, resume, imported };
}
