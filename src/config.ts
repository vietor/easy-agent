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
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new Error(`Config not found: create ~/${CONFIG_FILE} (see README for format).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ~/${CONFIG_FILE}.`);
  }
  const result = Config.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid config ~/${CONFIG_FILE}:\n  ${issues}`);
  }
  return result.data;
}
