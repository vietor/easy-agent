import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z, LLMConfigSchema, MCPServerConfigSchema, type ResolvedLLMConfig, type ResolvedMCPServerConfig } from "@vietor/agent-core";

const CONFIG_PATH = ".easy-agent.json";

const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  mcpServers: z.record(z.string(), MCPServerConfigSchema).optional(),
});

export interface Config {
  llm: ResolvedLLMConfig;
  mcpServers?: Record<string, ResolvedMCPServerConfig>;
}

export function loadConfig(): Config {
  const path = join(homedir(), CONFIG_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Config not found: create ~/${CONFIG_PATH} (see README for format).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ~/${CONFIG_PATH}.`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid config ~/${CONFIG_PATH}:\n  ${issues}`);
  }
  return result.data;
}
