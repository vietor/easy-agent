import type { CommandContext, Command, CommandSchema } from "./types.js";
import { clearCommand, mcpCommand, compactCommand } from "./builtin.js";

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

  async execute(command: string, ctx: CommandContext, args: string): Promise<void> {
    const cmd = this.commands.get(command);
    if (!cmd) {
      ctx.error(`unknown command: /${command}`);
      return;
    }
    try {
      await cmd.execute(ctx, args);
    } catch (e) {
      ctx.error((e as Error).message);
    }
  }
}

export function registerBuiltinCommand(commands: CommandRegistry) {
  const builtins = [clearCommand, mcpCommand, compactCommand];
  for (const c of builtins) commands.register(c);
}
