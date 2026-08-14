import type { Session } from "@vietor/agent-core";

export interface SlashCommandContext {
  session: Session;
  message(text: string): void;
  error(text: string): void;
  requestExit(): void;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute(ctx: SlashCommandContext): Promise<void>;
}
