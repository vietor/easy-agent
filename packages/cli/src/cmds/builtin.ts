import { writeFileSync } from "node:fs";
import type { Command } from "@vietor/easy-agent-core";

export const exitCommand: Command = {
  name: "exit",
  description: "Exit the conversation",
  async execute() {
    return "exit";
  },
};

export const clearCommand: Command = {
  name: "clear",
  description: "Clear the conversation and log",
  async execute(ctx) {
    ctx.session.clear();
  },
};

export const mcpCommand: Command = {
  name: "mcp",
  description: "List linked MCP servers",
  async execute(ctx) {
    const servers = ctx.mcp.list();
    const text = servers.length
      ? [
          "MCP servers:",
          ...servers.map((s) => `❯ ${s.name} ⋅ ${s.type} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`),
        ].join("\n")
      : "No MCP servers linked.";
    ctx.message(text);
  },
};

export const compactCommand: Command = {
  name: "compact",
  description: "Compact the agent context",
  async execute(ctx) {
    try {
      const ok = await ctx.session.compact();
      if (ok) ctx.message("context compacted");
    } catch (e) {
      ctx.error((e as Error).message);
    }
  },
};

export const exportCommand: Command = {
  name: "export",
  description: "Export the conversation to a JSONL file",
  async execute(ctx) {
    try {
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
    } catch (e) {
      ctx.error((e as Error).message);
    }
  },
};

export const builtinCommands: Command[] = [
  exitCommand,
  { ...exitCommand, name: "quit" },
  clearCommand,
  mcpCommand,
  compactCommand,
  exportCommand,
];
