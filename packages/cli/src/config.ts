import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const CONFIG_FILE = ".easy-agent.json";

const LLMConfigSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  reasoningEffort: z.enum(["high", "max"]).default("high"),
  wireApi: z.enum(["completions", "anthropic", "responses"]).default("completions"),
  maxInputTokens: z.number().int().positive().default(1_000_000),
  maxOutputTokens: z.number().int().positive().default(128_000),
});

const MCPServerConfigSchema = z.union([
  z.object({
    type: z.literal("stdio").default("stdio"),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.enum(["http"]),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
]);

const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  mcpServers: z.record(z.string(), MCPServerConfigSchema).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

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
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid config ~/${CONFIG_FILE}:\n  ${issues}`);
  }
  return result.data;
}
