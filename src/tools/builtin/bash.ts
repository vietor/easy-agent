import { spawnSync } from "node:child_process";
import type { Tool } from "../types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : "/bin/sh";
const shellArgs = isWindows ? ["-NoProfile", "-Command"] : ["-c"];

export const bashTool: Tool = {
  name: "Bash",
  description: `Execute a shell command and return combined stdout and stderr. Runs synchronously through ${shell}${isWindows ? " (PowerShell; use PowerShell syntax, not POSIX)" : " (POSIX sh)"} with no stdin, so interactive prompts cannot be answered. Output is capped at ~10MB; for large files prefer Grep or FileRead. For URL content prefer WebFetch; use Bash for web requests only when WebFetch cannot (non-GET, custom headers, auth, raw bytes, or status codes).`,
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
