import type { CommandContext, CommandHost, Command, CommandSchema } from "./types.js";

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.name, command);
  }

  schemas(): CommandSchema[] {
    return [...this.commands.values()].map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  exists(name: string): boolean {
    return this.commands.has(name);
  }

  async execute(command: string, ctx: CommandContext, host: CommandHost): Promise<void> {
    const cmd = this.commands.get(command);
    if (!cmd) {
      host.error(`unknown command: /${command}`);
      return;
    }
    await cmd.execute(ctx, host);
  }
}