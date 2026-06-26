import { spawnSync } from "node:child_process";
import type { Tool } from "../types.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : "/bin/sh";
const shellArgs = isWindows ? ["-NoProfile", "-Command"] : ["-c"];
const prefix = isWindows
  ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
  : "";

const DESCRIPTION = [
  "Execute a shell command and return combined stdout and stderr.",
  isWindows
    ? "Runs on Windows PowerShell 5.1 (powershell.exe), NOT pwsh (PowerShell 7+). Chain commands with semicolons; conditional command chaining, null-coalescing, and ternary operators are pwsh-only and unsupported here."
    : `Runs on ${shell} (POSIX sh).`,
  "Runs synchronously with no stdin, so interactive prompts cannot be answered.",
  "Output is capped at ~10MB; for large files prefer Grep or FileRead.",
  "For URL content prefer WebFetch; use Shell for web requests only when WebFetch cannot (non-GET, custom headers, auth, raw bytes, or status codes).",
].join(" ");

export const shellTool: Tool = {
  name: "Shell",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args) {
    const command = args.command as string;
    const result = spawnSync(shell, [...shellArgs, prefix + command], {
      encoding: "utf-8",
      maxBuffer: 1024 * 1024 * 10,
    });
    if (result.status === 0 && !result.error) {
      return result.stdout || "(no output)";
    }
    return (
      (result.stdout || "") +
      (result.stderr || "") +
      (result.error?.message || "")
    );
  },
  summarize(args) {
    return (args.command as string) ?? "";
  },
};
