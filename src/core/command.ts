import { writeFileSync } from "node:fs";
import type { Agent } from "./agent.js";
import type { MCPServers } from "../mcp/server.js";

export interface CommandContext {
  agent: Agent;
  mcp: MCPServers;
}

export interface CommandUI {
  exit(): void;
  clearLog(): void;
  showSystem(text: string): void;
  showError(text: string): void;
  thinking(on: boolean): void;
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext, ui: CommandUI): Promise<void>;
}

const commands = new Map<string, Command>();

export function register(command: Command): void {
  commands.set(command.name, command);
}

export function listCommands(): Command[] {
  return Array.from(commands.values());
}

export async function runCommand(
  command: string,
  ctx: CommandContext,
  ui: CommandUI
): Promise<void> {
  const cmd = commands.get(command);
  if (!cmd) {
    ui.showError(`unknown command: /${command}`);
    return;
  }
  await cmd.execute(ctx, ui);
}

const exitCommand: Command = {
  name: "exit",
  description: "Exit the session",
  async execute(_ctx, ui) {
    ui.exit();
  },
};

register(exitCommand);
register({ ...exitCommand, name: "quit" });

register({
  name: "clear",
  description: "Clear the conversation and log",
  async execute(ctx, ui) {
    ctx.agent.clear();
    ui.clearLog();
  },
});

register({
  name: "mcp",
  description: "List linked MCP servers",
  async execute(ctx, ui) {
    const servers = ctx.mcp.list();
    const text = servers.length
      ? ["MCP servers:", ...servers.map((s) => `❯ ${s.name} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`)].join("\n")
      : "No MCP servers linked.";
    ui.showSystem(text);
  },
});

register({
  name: "compact",
  description: "Compact the agent context",
  async execute(ctx, ui) {
    ui.thinking(true);
    try {
      await ctx.agent.compact();
      ui.showSystem("context compacted");
    } catch (e) {
      ui.showError((e as Error).message);
    } finally {
      ui.thinking(false);
    }
  },
});

register({
  name: "export",
  description: "Export the session to a JSONL file",
  async execute(ctx, ui) {
    try {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const file = `session-${ts}.jsonl`;
      const lines = ctx.agent.export().map((m) => JSON.stringify(m)).join("\n");
      writeFileSync(file, lines + "\n", "utf-8");
      ui.showSystem(`exported to ${file}`);
    } catch (e) {
      ui.showError((e as Error).message);
    }
  },
});
