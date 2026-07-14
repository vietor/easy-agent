import { writeFileSync } from "node:fs";
import type { Command } from "@vietor/easy-agent-core";

export const exitCommand: Command = {
  name: "exit",
  description: "Exit the conversation",
  async execute(ctx) {
    ctx.session.local.set("exitRequested", true);
  },
};

export const exportCommand: Command = {
  name: "export",
  description: "Export the conversation to a JSONL file",
  async execute(ctx) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const file = `conversation-${ts}.jsonl`;
    const lines = ctx.session
      .export()
      .map((m) => JSON.stringify(m))
      .join("\n");
    writeFileSync(file, lines + "\n", "utf-8");
    ctx.message(`exported to ${file}`);
  },
};

export const builtinCommands: Command[] = [
  exitCommand,
  { ...exitCommand, name: "quit" },
  exportCommand,
];
