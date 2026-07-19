import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const CONFIG_FILE = ".easy-agent.json";

const LLMConfig = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  reasoningEffort: z.enum(["none", "high", "max"]).default("none"),
});

const StdioServerConfig = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

const RemoteServerConfig = z.object({
  type: z.enum(["http"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

const MCPServerConfig = z.union([StdioServerConfig, RemoteServerConfig]);

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
