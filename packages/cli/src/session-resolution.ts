import { resolve } from "node:path";
import { isSessionExists, isSessionFile, listSessions } from "@vietor/agent-core";

export interface CliOptions {
  continue?: boolean;
  resume?: string | boolean;
  import?: string;
}

export interface ResolvedSession {
  sessionId?: string;
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
  let importPath: string | undefined;
  if (opts.import) {
    const path = resolve(opts.import);
    if (!isSessionFile(path)) {
      console.error(`Not a session file: ${path}`);
      process.exit(1);
    }
    importPath = path;
  } else if (opts.continue) {
    const sessions = listSessions(sessionDir);
    if (sessions.length) {
      sessionId = sessions[0].id;
    }
  } else if (opts.resume && typeof opts.resume === "string") {
    sessionId = opts.resume;
  }
  if (sessionId && !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
    console.error(`Invalid session id: ${sessionId}`);
    process.exit(1);
  }
  if (sessionId && !isSessionExists(sessionDir, sessionId)) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  return { sessionId, importPath };
}
