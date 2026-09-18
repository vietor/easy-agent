import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { createSession, loadSessionState, sessionFilePath, tryLoadSkills } from "@vietor/agent-core";
import { loadConfig } from "./config.js";
import { assembleSystemPrompt } from "./prompts.js";
import { printSessions, resolveSession, type CliOptions } from "./session-resolution.js";
import { startApp } from "./tui/app.js";
import { getPackageInfo } from "./util/package.js";
import { localScriptTool } from "./tools/local-script.js";

export async function main(argv: string[] = []): Promise<void> {
  const pkg = getPackageInfo();
  const program = new Command();
  program
    .name("easy-agent")
    .version(pkg.version)
    .description("Terminal-based AI agent CLI with conversational TUI")
    .option("-c, --continue", "Continue the most recent session")
    .option("-r, --resume [id]", "Resume a session by ID (omit to list sessions)")
    .option("--import <file>", "Import a session from a saved JSONL file")
    .parse(argv, { from: "user" });

  const opts = program.opts() as CliOptions;

  const cwd = process.cwd();
  const projectName = cwd.replace(/[\/\\:]/g, "-");
  const sessionDir = join(homedir(), ".easy-agent", "sessions", projectName);
  const toolSpoolDir = join(homedir(), ".easy-agent", "tool-output", projectName);

  if (opts.import && (opts.continue || opts.resume !== undefined)) {
    console.error("--import cannot be combined with --continue or --resume");
    process.exit(1);
  }

  if (opts.resume !== undefined && typeof opts.resume !== "string") {
    printSessions(sessionDir, program.name());
    return;
  }

  const config = loadConfig();

  const { sessionId, resume, imported } = resolveSession(sessionDir, opts);

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
    sessionDir,
    toolSpoolDir,
    clientInfo: { name: pkg.name, version: pkg.version },
    tools: [localScriptTool],
  });

  if (resume) {
    const state = loadSessionState(sessionFilePath(sessionDir, sessionId));
    if (!state) {
      console.error(`Session not found: ${sessionId}`);
      session.dispose();
      process.exit(1);
    }
    session.importState(state);
  } else if (imported) {
    session.importState(imported);
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    session.dispose();
    session.save().catch(() => {}).finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const app = startApp(session);
  await app.waitUntilExit().finally(async () => {
    session.dispose();
    await session.save().catch(() => {});
    console.log(["Resume this session with:", `${program.name()} --resume ${sessionId}`].join("\n"));
  });
}
