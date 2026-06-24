import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function loadConfig(): Config {
  const path = join(homedir(), ".easy-agent.json");
  const raw = readFileSync(path, "utf-8");
  const cfg = JSON.parse(raw) as Partial<Config>;
  if (!cfg.apiKey) throw new Error("apiKey missing in ~/.easy-agent.json");
  if (!cfg.model) throw new Error("model missing in ~/.easy-agent.json");
  return {
    baseUrl: cfg.baseUrl ?? "",
    apiKey: cfg.apiKey,
    model: cfg.model,
  };
}
