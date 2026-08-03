#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { tryLoadSkills, tryReadFileText, createSession, SYSTEM_PROMPT_BOUNDARY } from "@vietor/easy-agent-core";
import { startApp } from "./tui/app.js";
import { getPackageInfo } from "./util/package.js";
import { FileSessionPersistence } from "./util/session-store.js";

function buildSystemPromptBase(cwd: string) {
  return [
    "You are Easy Agent, an autonomous assistant. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.",
    `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete; report outcomes faithfully.
- Reference code as file_path:line_number.`,
    `Environment:
- Platform: ${process.platform}
- Working directory: ${cwd}`,
    `Working style:
- Read relevant code/config before acting; do not guess implementation details or restate files from memory.
- Make surgical changes and match existing style; do not refactor unrelated code.
- Trust tool results as ground truth.`,
  ].join("\n\n");
}

async function listSessions(store: FileSessionPersistence): Promise<void> {
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
  console.log("\nResume with: easy-agent --resume <id>");
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
    await listSessions(store);
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

  const globalPrompt =
    tryReadFileText(join(homedir(), ".easy-agent", "AGENTS.md")) ??
    tryReadFileText(join(homedir(), ".claude", "CLAUDE.md"));
  const projectPrompt = tryReadFileText(join(cwd, "AGENTS.md")) ?? tryReadFileText(join(cwd, "CLAUDE.md"));

  const systemPrompt = [buildSystemPromptBase(cwd), globalPrompt, projectPrompt]
    .filter(Boolean)
    .join(SYSTEM_PROMPT_BOUNDARY);

  const session = await createSession({
    systemPrompt,
    llmConfig: config.llm,
    mcpServers: config.mcpServers,
    skills: globalSkills,
    builtinTools: {
      askUser: true,
      todoWrite: true,
      skill: true,
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

  const app = startApp(session);
  await app.waitUntilExit().finally(async () => {
    session.dispose();
    await session.flush();
    console.log(["Resume this session with:", `easy-agent --resume ${sessionId}`].join("\n"));
  });
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e);
  process.exit(1);
});
