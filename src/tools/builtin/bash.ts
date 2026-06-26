import { spawnSync } from "node:child_process";
import type { Tool } from "../types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : "/bin/sh";
const shellArgs = isWindows ? ["-NoProfile", "-Command"] : ["-c"];

export const bashTool: Tool = {
  name: "Bash",
  description: `Execute a shell command and return combined stdout and stderr. Commands run through ${shell}${isWindows ? " (PowerShell, not a POSIX shell); use PowerShell syntax accordingly" : "; use POSIX shell syntax accordingly"}. For fetching URL content, prefer the WebFetch tool over curl/Invoke-WebRequest; use Bash for web requests only when WebFetch cannot do the job (non-GET methods, custom headers, auth, raw bytes, status codes, or piping the response).`,
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args) {
    const command = args.command as string;
    const result = spawnSync(shell, [...shellArgs, command], {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (result.status === 0 && !result.error) {
      return result.stdout || "(no output)";
    }
    return (result.stdout || "") + (result.stderr || "") + (result.error?.message || "");
  },
  summarize(args) {
    return (args.command as string) ?? "";
  },
};
