import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { llmConfigSchema, mcpServerConfigSchema } from "@vietor/easy-agent-core";

const CONFIG_FILE = ".easy-agent.json";

const Config = z.object({
  llm: llmConfigSchema,
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
});

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
