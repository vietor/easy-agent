import type { Session } from "@vietor/agent-core";
import { toErrorMessage } from "@vietor/agent-core/util";
import { builtinCommands } from "./builtin.js";
import type { SlashCommandContext, SlashCommandInfo } from "./types.js";

const commands = new Map(builtinCommands.map((c) => [c.name, c]));

export async function executeSlashCommand(
  name: string,
  session: Session,
  requestExit: () => void,
  persist: () => void
): Promise<void> {
  const cmd = commands.get(name);
  if (cmd) {
    const ctx: SlashCommandContext = { session, message: session.addNotice, error: session.addError, requestExit };
    try {
      await cmd.execute(ctx);
    } catch (e) {
      ctx.error(toErrorMessage(e));
    }
    persist();
    return;
  }
  try {
    if (await session.runSkill(name)) {
      persist();
      return;
    }
  } catch (e) {
    session.addError(toErrorMessage(e));
    return;
  }
  session.addError(`unknown command: /${name}`);
}

export function slashCommandInfos(session: Session): SlashCommandInfo[] {
  const map = new Map<string, SlashCommandInfo>();
  for (const c of builtinCommands) map.set(c.name, { name: c.name, description: c.description });
  for (const s of session.skills) if (!map.has(s.name)) map.set(s.name, { name: s.name, description: s.description ?? s.name });
  return [...map.values()];
}
