import type { Command, CommandContext } from "./types.js";

export const mcpCommand: Command = {
  name: "mcp",
  description: "List linked MCP servers",
  async execute(ctx: CommandContext) {
    const servers = ctx.session.mcpServers;
    const text = servers.length
      ? [
          "MCP servers:",
          ...servers.map((s) => `❯ ${s.name} ⋅ ${s.type} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`),
        ].join("\n")
      : "No MCP servers linked.";
    ctx.message(text);
  },
};

export const clearCommand: Command = {
  name: "clear",
  description: "Clear the conversation and log",
  async execute(ctx: CommandContext) {
    ctx.session.clear();
  },
};

export const compactCommand: Command = {
  name: "compact",
  description: "Compact the agent context",
  async execute(ctx: CommandContext) {
    await ctx.session.compact();
  },
};

export const builtinCommands: Command[] = [
  clearCommand,
  mcpCommand,
  compactCommand,
];
