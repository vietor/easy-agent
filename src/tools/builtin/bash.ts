import { execSync } from "node:child_process";
import type { Tool } from "../types.js";

export const bashTool: Tool = {
  name: "Bash",
  description:
    "Execute a shell command and return combined stdout and stderr. On Windows, commands run through cmd.exe (not a POSIX shell); use cmd.exe syntax accordingly.",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args) {
    const command = args.command as string;
    try {
      const out = execSync(command, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 10,
      });
      return out || "(no output)";
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return (err.stdout || "") + (err.stderr || "") + (err.message || "");
    }
  },
};
