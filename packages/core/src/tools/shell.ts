import { runProcess } from "../util/subprocess.js";
import type { Tool, ToolResult } from "./types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
const shellArgs = isWindows ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-c"];
const commandPrefix = isWindows
  ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
  : "";

const PRIVILEGED_RE = /(^|[;&|()`\n])\s*(sudo|su|doas|pkexec)\b/;

const DESCRIPTION = [
  isWindows
    ? "Run a command in the working directory via Windows PowerShell 5.1 (powershell.exe; NOT pwsh/PowerShell 7). It is not bash: chain with ';' not '&&'/'||' (for run-on-success: 'if ($?) {...}'); env vars are '$env:NAME' not '$NAME'; 'ls'/'rm'/'cp' are PowerShell aliases - use cmdlet parameters (-Recurse, -Force), not GNU flags (-la, -rf)."
    : "Execute a bash command in the working directory. Privileged commands (sudo/su/doas/pkexec) are blocked.",
  "No stdin/interactive prompts or long-running commands (dev servers, `tail -f`, watch mode); they hang until timeout.",
].join(" ");

export const shellTool: Tool = {
  name: "Shell",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const command = args.command as string;
    if (!isWindows && PRIVILEGED_RE.test(command)) {
      return { content: "Error: privileged commands (sudo/su/doas/pkexec) are not allowed", isError: true };
    }
    const r = await runProcess(shell, [...shellArgs, commandPrefix + command], { cwd: ctx.cwd, timeout: 300_000 }, ctx.signal);
    if (r.status === 0 && !r.error) {
      return { content: r.stdout || "(no output)" };
    }
    const parts = [r.stdout, r.stderr, r.error?.message].filter(Boolean);
    return {
      content: parts.join("\n") || "(no output)",
      isError: true,
    };
  },
  getPreview(result) {
    return result.isError ? "Command failed" : "Command executed";
  },
  summaryArg: "command",
};
