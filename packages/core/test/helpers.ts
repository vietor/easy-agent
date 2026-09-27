import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMAssistantMessage } from "../src/llm/messages.js";
import type { ChatOptions, LLMClient, LLMUsage } from "../src/llm/types.js";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function fakeLLM(script: Array<(opts: ChatOptions) => LLMAssistantMessage>) {
  const calls: ChatOptions[] = [];
  const llm: LLMClient = {
    model: "fake",
    thinkingEffort: "high",
    maxInputTokens: 200000,
    maxOutputTokens: 128000,
    chat: async (opts) => {
      calls.push(opts);
      const fn = script.shift();
      if (!fn) throw new Error("no scripted response");
      return fn(opts);
    },
  };
  return { llm, calls };
}

export function toolCall(name: string, args = "{}", id = "t1"): LLMAssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

export function withUsage(usage: LLMUsage, message: LLMAssistantMessage) {
  return (opts: ChatOptions): LLMAssistantMessage => {
    opts.onUsage?.(usage);
    return message;
  };
}

export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "session-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function waitUntil(fn: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
