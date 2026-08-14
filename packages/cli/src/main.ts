import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { createSession, tryLoadSkills } from "@vietor/agent-core";
import { startApp } from "./tui/app.js";
import { getPackageInfo } from "./util/package.js";
import { FileSessionPersistence } from "./session-persistence.js";
import { assembleSystemPrompt } from "./system-prompt.js";

async function listSessions(store: FileSessionPersistence, name: string): Promise<void> {
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

export async function main(argv: string[] = []): Promise<void> {
  const pkg = getPackageInfo();
  const program = new Command();
  program
    .name("easy-agent")
    .version(pkg.version)
    .description("Terminal-based AI agent CLI with conversational TUI")
    .option("-c, --continue", "Continue the most recent session")
    .option("-r, --resume [id]", "Resume a session by ID (omit to list sessions)")
    .parse(argv, { from: "user" });

  const opts = program.opts() as { continue?: boolean; resume?: string | boolean };

  const cwd = process.cwd();
  const store = new FileSessionPersistence(cwd);

  if (opts.resume !== undefined && typeof opts.resume !== "string") {
    await listSessions(store, program.name());
    return;
  }

  const config = loadConfig();

  let sessionId: string | undefined;
  let resume = false;
  if (opts.continue) {
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

  const globalSkills =
    tryLoadSkills(join(homedir(), ".easy-agent", "skills")) ?? tryLoadSkills(join(homedir(), ".claude", "skills"));

  const systemPrompt = assembleSystemPrompt(cwd);

  const session = await createSession({
    systemPrompt,
    llm: config.llm,
    mcpServers: config.mcpServers,
    skills: globalSkills,
    builtInTools: {
      askUser: true,
      todoWrite: true,
      subAgent: true,
    },
    cwd: cwd,
    sessionId,
    persistence: store,
  });

  if (resume) {
    const restored = await session.restore();
    if (!restored) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    session.dispose();
    session.flush().catch(() => {}).finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.stdout.write("[2J[H");
  const app = startApp(session);
  await app.waitUntilExit().finally(async () => {
    session.dispose();
    await session.flush();
    console.log(["Resume this session with:", `${program.name()} --resume ${sessionId}`].join("\n"));
  });
}
