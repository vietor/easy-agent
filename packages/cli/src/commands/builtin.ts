import { writeFileSync } from "node:fs";
import type { SlashCommand } from "./types.js";

export const clearCommand: SlashCommand = {
  name: "clear",
  description: "Clear the session and log",
  async execute(ctx) {
    ctx.session.clear();
  },
};

export const mcpCommand: SlashCommand = {
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

export const compactCommand: SlashCommand = {
  name: "compact",
  description: "Compact the agent context",
  async execute(ctx) {
    await ctx.session.compact();
  },
};

export const skillCommand: SlashCommand = {
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

export const exitCommand: SlashCommand = {
  name: "exit",
  description: "Exit the conversation",
  async execute(ctx) {
    ctx.requestExit();
  },
};

export const saveCommand: SlashCommand = {
  name: "save",
  description: "Save the session to a JSONL file",
  async execute(ctx) {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const file = `session-${ts}.jsonl`;
    const lines = ctx.session
      .export()
      .map((m) => JSON.stringify(m))
      .join("\n");
    writeFileSync(file, lines + "\n", "utf-8");
    ctx.message(`saved to ${file}`);
  },
};

export const builtinCommands: SlashCommand[] = [
  clearCommand,
  mcpCommand,
  compactCommand,
  skillCommand,
  exitCommand,
  saveCommand,
];
