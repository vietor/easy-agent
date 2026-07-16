import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import {
  tryLoadSkills,
  tryReadFileText,
  createSession,
} from "@vietor/easy-agent-core";
import { builtinCommands } from "./cmds/builtin.js";
import { startApp } from "./tui/App.js";
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

function parseArgs(argv: string[]): { mode: "new" | "continue" | "resume"; id?: string } {
  let mode: "new" | "continue" | "resume" = "new";
  let id: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-c" || a === "--continue") {
      mode = "continue";
    } else if (a === "-r" || a === "--resume") {
      mode = "resume";
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        id = next;
        i++;
      }
    }
  }
  return { mode, id };
}

function listSessions(store: FileSessionPersistence): void {
  const sessions = store.listSessions();
  if (!sessions.length) {
    console.log("No previous sessions found in this directory.");
    return;
  }
  console.log("Previous sessions (most recent first):");
  for (const s of sessions) {
    console.log(`  ${s.id}  ${new Date(s.mtime).toLocaleString()}`);
  }
  console.log("\nResume with: easy-agent --resume <id>");
}

export async function main(argv: string[] = []): Promise<void> {
  const { mode, id } = parseArgs(argv);
  const store = new FileSessionPersistence(process.cwd());

  if (mode === "resume" && !id) {
    listSessions(store);
    return;
  }

  const config = loadConfig();

  let sessionId: string | undefined;
  let resume = false;
  if (mode === "continue") {
    const sessions = store.listSessions();
    if (sessions.length) {
      sessionId = sessions[0].id;
      resume = true;
    }
  } else if (mode === "resume" && id) {
    sessionId = id;
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

  if (resume) session.restore();

  const app = startApp(session);
  await app.waitUntilExit().finally(() => session.dispose());
}
