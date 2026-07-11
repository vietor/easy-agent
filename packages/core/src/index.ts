// Used by CLI — kept exports
export type { Session } from "./core/session.js";
export type { LogEntry } from "./core/logstore.js";
export { ToolRegistry } from "./tools/registry.js";
export type { Todo, TodoStatus } from "./tools/types.js";
export { tryLoadSkills } from "./skills/loader.js";
export { CommandRegistry } from "./cmds/registry.js";
export type { Command, CommandSchema } from "./cmds/types.js";
export { tryReadFileText, readFirstFileContent } from "./util/fs.js";
export { getPackageInfo } from "./util/package.js";

import { LLMClient } from "./llm/client.js";
import type { LLMConfig } from "./llm/types.js";
import { Session } from "./core/session.js";
import { ToolRegistry, registerBuiltinTools } from "./tools/registry.js";
import { MCPServers } from "./mcp/server.js";
import type { MCPServerConfig } from "./mcp/types.js";
import { CommandRegistry } from "./cmds/registry.js";
import type { Skill } from "./skills/types.js";

export async function startSession(
  systemPrompt: string,
  llmConfig: LLMConfig,
  mcpServers?: Record<string, MCPServerConfig>,
  skills?: Skill[],
  customLoad?: (tools: ToolRegistry, commands: CommandRegistry) => void,
): Promise<Session> {
  const llm = new LLMClient(llmConfig);

  const tools = new ToolRegistry();
  registerBuiltinTools(tools);

  const mcp = new MCPServers(tools);
  if (mcpServers) {
    await mcp.connect(mcpServers);
  }

  const commands = new CommandRegistry();

  if (skills) {
    skills.forEach((skill) =>
      commands.register({
        name: skill.name,
        description: skill.description ?? skill.name,
        execute: async (_, host) => {
          await host.runSkill(skill);
        },
      }),
    );
  }

  if (customLoad) {
    customLoad(tools, commands);
  }

  return new Session(llm, systemPrompt, tools, commands, mcp);
}
