import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import {
  tryLoadSkills,
  tryReadFileText,
  createSession,
} from "@vietor/easy-agent-core";
import { builtinCommands } from "./cmds/builtin.js";
import { startApp } from "./tui/App.js";
import { getPackageInfo } from "./util/package.js";
import { FileSessionPersistence } from "./util/sessionStore.js";

const SYSTEM_PROMPT_BASE = [
  "You are Easy Agent, an autonomous assistant. You complete tasks by calling tools, inspecting their results, and iterating until the work is done.",
  `Output:
- Be concise and use GitHub-flavored markdown.
- State what you did and stop once the task is complete; report outcomes faithfully.
- Reference code as file_path:line_number.`,
  `Environment:
- Platform: ${process.platform}
- Working directory: ${process.cwd()}`,
  `Decision making:
- When a decision belongs to the user, call AskUser and wait for the answer rather than listing options in prose. Ask when there are multiple reasonable approaches, an irreversible or consequential action, or the request is ambiguous; when you have enough to proceed, act without asking.`,
].join("\n\n");

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
  const store = new FileSessionPersistence(process.cwd());

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

  const globalSkills = tryLoadSkills(join(homedir(), ".easy-agent", "skills"))
    ?? tryLoadSkills(join(homedir(), ".claude", "skills"));

  const globalPrompt = tryReadFileText(join(homedir(), ".easy-agent", "AGENTS.md"))
    ?? tryReadFileText(join(homedir(), ".claude", "CLAUDE.md"));
  const projectPrompt = tryReadFileText(join(process.cwd(), "AGENTS.md"))
    ?? tryReadFileText(join(process.cwd(), "CLAUDE.md"));

  const systemPrompt = [SYSTEM_PROMPT_BASE, globalPrompt, projectPrompt]
    .filter(Boolean)
    .join("\n\n=================\n\n");

  const session = await createSession({
    systemPrompt,
    llmConfig: config.llm,
    mcpServers: config.mcpServers,
    skills: globalSkills,
    commands: builtinCommands,
    builtinTools: {
      askUser: true,
      todoWrite: true
    },
    sessionId,
    persistence: store,
  });

  if (resume) await session.restore();

  const app = startApp(session);
  await app.waitUntilExit().finally(() => session.dispose());
}
