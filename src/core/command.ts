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

export async function runCommand(
  command: string,
  ctx: CommandContext,
  ui: CommandUI
): Promise<void> {
  switch (command) {
    case "exit":
    case "quit":
      ui.exit();
      return;
    case "clear":
      ctx.agent.clear();
      ui.clearLog();
      return;
    case "mcp": {
      const servers = ctx.mcp.list();
      const text = servers.length
        ? ["MCP servers:", ...servers.map((s) => `❯ ${s.name} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`)].join("\n")
        : "No MCP servers linked.";
      ui.showSystem(text);
      return;
    }
    case "compact":
      ui.thinking(true);
      try {
        await ctx.agent.compact();
        ui.showSystem("context compacted");
      } catch (e) {
        ui.showError((e as Error).message);
      } finally {
        ui.thinking(false);
      }
      return;
    case "export": {
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
      return;
    }
    default:
      ui.showError(`unknown command: /${command}`);
      return;
  }
}
