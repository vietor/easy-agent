import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { LLMConfig, MCPServerConfig } from "@vietor/agent-core";
import { DEFAULT_BACKEND, DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_THINKING_EFFORT } from "@vietor/agent-core/util";

const CONFIG_PATH = ".easy-agent.json";

const LLMConfigSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string(),
  model: z.string(),
  thinkingEffort: z.enum(["high", "max"]).default(DEFAULT_THINKING_EFFORT),
  backend: z.enum(["completions", "anthropic", "responses"]).default(DEFAULT_BACKEND),
  maxInputTokens: z.number().int().positive().default(DEFAULT_MAX_INPUT_TOKENS),
  maxOutputTokens: z.number().int().positive().default(DEFAULT_MAX_OUTPUT_TOKENS),
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

export interface Config {
  llm: LLMConfig;
  mcpServers?: Record<string, MCPServerConfig>;
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
