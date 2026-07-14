import type { CommandContext, Command, CommandResult, CommandSchema } from "./types.js";

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

  async execute(command: string, ctx: CommandContext): Promise<CommandResult> {
    const cmd = this.commands.get(command);
    if (!cmd) {
      ctx.error(`unknown command: /${command}`);
      return;
    }
    return cmd.execute(ctx);
  }
}
