import { writeFileSync } from "node:fs";
import type { Command } from "./types.js";

export const exitCommand: Command = {
  name: "exit",
  description: "Exit the conversation",
  async execute(_ctx, host) {
    host.exit();
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
  async execute(ctx, host) {
    const servers = ctx.mcp.list();
    const text = servers.length
      ? [
          "MCP servers:",
          ...servers.map((s) => `❯ ${s.name} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`),
        ].join("\n")
      : "No MCP servers linked.";
    host.info(text);
  },
};

export const compactCommand: Command = {
  name: "compact",
  description: "Compact the agent context",
  async execute(ctx, host) {
    host.thinking(true);
    try {
      const ok = await ctx.session.compact();
      if (ok) host.info("context compacted");
    } catch (e) {
      host.error((e as Error).message);
    } finally {
      host.thinking(false);
    }
  },
};

export const exportCommand: Command = {
  name: "export",
  description: "Export the conversation to a JSONL file",
  async execute(ctx, host) {
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
      host.info(`exported to ${file}`);
    } catch (e) {
      host.error((e as Error).message);
    }
  },
};
