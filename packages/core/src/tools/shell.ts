import { runProcess } from "../util/subprocess.js";
import type { Tool } from "./types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : "/bin/sh";
const shellArgs = isWindows ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-c"];
const commandPrefix = isWindows
  ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
  : "";

const DESCRIPTION = [
  "Execute a shell command and return combined stdout and stderr.",
  isWindows
    ? "Runs on Windows PowerShell 5.1 (powershell.exe), NOT pwsh (PowerShell 7+). Chain commands with semicolons; conditional command chaining, null-coalescing, and ternary operators are pwsh-only and unsupported here."
    : `Runs on ${shell} (POSIX sh).`,
  "Runs synchronously with no stdin, so interactive prompts cannot be answered.",
  "Output is capped at ~10MB; for large files prefer Grep or FileRead.",
  "Prefer dedicated tools over Shell: FileRead/FileWrite/FileEdit for files, Glob/Grep for searching, WebFetch for URLs. Use Shell for web requests only when WebFetch cannot (non-GET, custom headers, auth, raw bytes, or status codes).",
  ...(isWindows ? [] : ["On Linux, use sudo -n for privileged commands (non-interactive); if a password is required, do not retry — surface the command for the user to run manually."]),
].join(" ");

export const shellTool: Tool = {
  name: "Shell",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args, ctx) {
    const command = args.command as string;
    const r = await runProcess(shell, [...shellArgs, commandPrefix + command], { cwd: ctx.cwd }, ctx.signal);
    if (r.status === 0 && !r.error) {
      return r.stdout || "(no output)";
    }
    return (r.stdout || "") + (r.stderr || "") + (r.error?.message || "");
  },
  summaryArg: "command",
};
