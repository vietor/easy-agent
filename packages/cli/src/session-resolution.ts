import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { listSessions, loadSessionState, sessionFilePath } from "@vietor/agent-core";

export interface CliOptions {
  continue?: boolean;
  resume?: string | boolean;
  import?: string;
}

export interface ResolvedSession {
  sessionId: string;
  importPath?: string;
}

export function printSessions(sessionDir: string, name: string): void {
  const sessions = listSessions(sessionDir);
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

export function resolveSession(sessionDir: string, opts: CliOptions): ResolvedSession {
  let sessionId: string | undefined;
  let resume = false;
  let importPath: string | undefined;
  if (opts.import) {
    const path = resolve(opts.import);
    const state = loadSessionState(path);
    if (!state) {
      console.error(`Import file not found: ${path}`);
      process.exit(1);
    }
    if (!state.messages.length) {
      console.error(`No session messages found in: ${path}`);
      process.exit(1);
    }
    importPath = path;
  } else if (opts.continue) {
    const sessions = listSessions(sessionDir);
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
  if (resume && !existsSync(sessionFilePath(sessionDir, sessionId))) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  return { sessionId, importPath };
}
