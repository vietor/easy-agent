import type { Agent } from "../core/agent.js";
import type { MCPServers } from "../mcp/server.js";
import { Skill } from "../skills/types.js";

export interface CommandContext {
  agent: Agent;
  mcp: MCPServers;
}

export interface CommandHost {
  exit(): void;
  clearLog(): void;
  info(text: string): void;
  error(text: string): void;
  thinking(on: boolean): void;
  runSkill(skill: Skill): Promise<void>;
}

export interface CommandSchema {
  name: string;
  description: string;
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext, host: CommandHost): Promise<void>;
}
