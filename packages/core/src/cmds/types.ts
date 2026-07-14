import type { Session } from "../core/session.js";

export interface CommandContext {
  session: Session;
  host: Map<string, unknown>;
  message(text: string): void;
  error(text: string): void;
}

export interface CommandSchema {
  name: string;
  description: string;
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext, args: string): Promise<void>;
}
