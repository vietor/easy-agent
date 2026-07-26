import { runProcess } from "../util/subprocess.js";
import type { Tool, ToolResult } from "./types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : "/bin/sh";
const shellArgs = isWindows ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-c"];
const commandPrefix = isWindows
  ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
  : "";

const PRIVILEGED_RE = /(^|[;&|()`\n])\s*(sudo|su|doas|pkexec)\b/;

const DESCRIPTION = isWindows
  ? "Execute a PowerShell command (powershell.exe, NOT pwsh) in the working directory. Use semicolons for chaining. No stdin/interactive prompts."
  : "Execute a POSIX sh command in the working directory. No stdin/interactive prompts. Privileged commands (sudo/su/doas/pkexec) are blocked.";

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
