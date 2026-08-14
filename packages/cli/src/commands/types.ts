import type { Session } from "@vietor/agent-core";

export interface CommandContext {
  session: Session;
  message(text: string): void;
  error(text: string): void;
  requestExit(): void;
}

export interface CommandSchema {
  name: string;
  description: string;
}

export interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext): Promise<void>;
}
