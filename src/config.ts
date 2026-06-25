import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const CONFIG_FILE = ".easy-agent.json";

const LLMConfig = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
});

const MCPServerConfig = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const Config = z.object({
  llm: LLMConfig,
  mcpServers: z.record(z.string(), MCPServerConfig).optional(),
});

export type LLMConfig = z.infer<typeof LLMConfig>;
export type MCPServerConfig = z.infer<typeof MCPServerConfig>;
export type Config = z.infer<typeof Config>;

export function loadConfig(): Config {
  const path = join(homedir(), CONFIG_FILE);
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const result = Config.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid config ~/${CONFIG_FILE}:\n  ${issues}`);
  }
  return result.data;
}
