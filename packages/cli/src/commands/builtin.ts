import { writeFileSync } from "node:fs";
import type { Command } from "./types.js";

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
    const servers = ctx.session.mcpServers;
    const text = servers.length
      ? [
          "MCP servers:",
          ...servers.map((s) => {
            const base = `❯ ${s.name} ⋅ ${s.type} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`;
            return s.error ? `${base}\n  ${s.error}` : base;
          }),
        ].join("\n")
      : "No MCP servers linked.";
    ctx.message(text);
  },
};

export const compactCommand: Command = {
  name: "compact",
  description: "Compact the agent context",
  async execute(ctx) {
    await ctx.session.compact();
  },
};

export const skillCommand: Command = {
  name: "skill",
  description: "List available skills",
  async execute(ctx) {
    const skills = ctx.session.skills;
    const text = skills.length
      ? [
          "Skills:",
          ...skills.map((s) => `❯ ${s.name} ∶ ${s.description || "no description"}`),
        ].join("\n")
      : "No skills available.";
    ctx.message(text);
  },
};

export const exitCommand: Command = {
  name: "exit",
  description: "Exit the conversation",
  async execute(ctx) {
    ctx.requestExit();
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

export const quitCommand: Command = {
  name: "quit",
  description: "Exit the conversation",
  async execute(ctx) {
    ctx.requestExit();
  },
};

export const builtinCommands: Command[] = [
  clearCommand,
  mcpCommand,
  compactCommand,
  skillCommand,
  exitCommand,
  quitCommand,
  exportCommand,
];
