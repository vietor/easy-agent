import { runProcess } from "../util/subprocess.js";
import type { Tool, ToolResult } from "./types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : "/bin/sh";
const shellArgs = isWindows ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-c"];
const commandPrefix = isWindows
  ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
  : "";

const DESCRIPTION = isWindows
  ? "Execute a PowerShell command (powershell.exe, NOT pwsh). Use semicolons for chaining. No stdin/interactive prompts."
  : "Execute a POSIX sh command. No stdin/interactive prompts. Use sudo -n for privileged commands.";

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
    const r = await runProcess(shell, [...shellArgs, commandPrefix + command], { cwd: ctx.cwd }, ctx.signal);
    if (r.status === 0 && !r.error) {
      return { content: r.stdout || "(no output)" };
    }
    return {
      content: (r.stdout || "") + (r.stderr || "") + (r.error?.message || ""),
      isError: true,
    };
  },
  summaryArg: "command",
};
