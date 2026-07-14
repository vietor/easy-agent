import type { Session } from "../core/session.js";
import type { MCPServers } from "../mcp/server.js";

export interface CommandContext {
  session: Session;
  mcp: MCPServers;
  message(text: string): void;
  error(text: string): void;
}

export type CommandResult = string | void;

export interface CommandSchema {
  name: string;
  description: string;
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext): Promise<CommandResult>;
}
