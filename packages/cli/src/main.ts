import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { createSession, SYSTEM_PROMPT_BOUNDARY, tryLoadSkills } from "@vietor/agent-core";
import { tryReadFileText } from "@vietor/agent-core/util";
import { startApp } from "./tui/app.js";
import { getPackageInfo } from "./util/package.js";
import { FileSessionPersistence } from "./session-persistence.js";

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

function assembleSystemPrompt(cwd: string): string {
  const globalPrompt =
    tryReadFileText(join(homedir(), ".easy-agent", "AGENTS.md")) ??
    tryReadFileText(join(homedir(), ".claude", "CLAUDE.md"));
  const projectPrompt = tryReadFileText(join(cwd, "AGENTS.md")) ?? tryReadFileText(join(cwd, "CLAUDE.md"));
  return [buildSystemPromptBase(cwd), globalPrompt, projectPrompt]
    .filter(Boolean)
    .join(SYSTEM_PROMPT_BOUNDARY);
}

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
    clientInfo: { name: pkg.name, version: pkg.version },
  });

  if (resume) {
    const state = await store.load(sessionId);
    if (!state) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    session.importState(state);
  }

  let saveChain: Promise<void> = Promise.resolve();
  const persist = (): void => {
    const state = session.exportState();
    saveChain = saveChain.catch(() => {}).then(() => store.saveAll(sessionId, state));
  };

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    session.dispose();
    saveChain.catch(() => {}).finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  process.stdout.write("[2J[H");
  const app = startApp(session, persist);
  await app.waitUntilExit().finally(async () => {
    session.dispose();
    await saveChain;
    console.log(["Resume this session with:", `${program.name()} --resume ${sessionId}`].join("\n"));
  });
}
