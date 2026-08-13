import { errorMessage, type Session } from "@vietor/easy-agent-core";
import { builtinCommands } from "./builtin.js";
import type { CommandContext, CommandSchema } from "./types.js";

const commands = new Map(builtinCommands.map((c) => [c.name, c]));

export async function executeCommand(name: string, session: Session): Promise<void> {
  const cmd = commands.get(name);
  if (cmd) {
    const ctx: CommandContext = { session, message: session.addNotice, error: session.addError };
    try {
      await cmd.execute(ctx);
    } catch (e) {
      ctx.error(errorMessage(e));
    }
    return;
  }
  try {
    if (await session.runSkill(name)) return;
  } catch (e) {
    session.addError(errorMessage(e));
    return;
  }
  session.addError(`unknown command: /${name}`);
}

export function commandSchemas(session: Session): CommandSchema[] {
  const map = new Map<string, CommandSchema>();
  for (const c of builtinCommands) map.set(c.name, { name: c.name, description: c.description });
  for (const s of session.skills) if (!map.has(s.name)) map.set(s.name, { name: s.name, description: s.description ?? s.name });
  return [...map.values()];
}
