import { randomUUID } from "node:crypto";
import type { AssistantMessage, Message } from "../llm/types.js";

export type SessionMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[一-龥぀-ヿ가-힯]/g) || []).length;
  const words = (text.match(/[a-zA-Z0-9']+/g) || []).length;
  return Math.ceil(cjk * 1.6 + words * 1.3 + (text.length - cjk) * 0.3);
}

function messageText(msg: SessionMessage): string {
  const parts: string[] = [];
  if (typeof msg.content === "string") parts.push(msg.content);
  else if (Array.isArray(msg.content)) {
    for (const p of msg.content) {
      if (p.type === "text") parts.push(p.text);
    }
  }
  if ("tool_calls" in msg && msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      if (tc.function?.name) parts.push(tc.function.name);
      if (tc.function?.arguments) parts.push(tc.function.arguments);
    }
  }
  return parts.join(" ");
}

export class Session {
  private messages: SessionMessage[] = [];
  private estimatedTokens = 0;
  private checkpoint?: SessionMessage[];
  private checkpointTokens = 0;

  constructor(private system: string) {
    this.messages.push({ role: "system", content: system });
    this.estimatedTokens = estimateTokens(system);
  }

  getEstimatedTokens(): number {
    return this.estimatedTokens;
  }

  add(msg: SessionMessage): void {
    this.messages.push(msg);
    this.estimatedTokens += estimateTokens(messageText(msg));
  }

  toLLM(): Message[] {
    return this.messages.map((m) => (m.role === "skill" ? { role: "user", name: m.name, content: m.content } : m));
  }

  export(): SessionMessage[] {
    return this.messages.slice(1);
  }

  clear(): void {
    this.messages = [{ role: "system", content: this.system }];
    this.estimatedTokens = estimateTokens(this.system);
  }

  compact(summary: string): void {
    this.messages = [
      { role: "system", content: this.system },
      { role: "assistant", content: summary },
    ];
    this.estimatedTokens = estimateTokens(this.system) + estimateTokens(summary);
  }

  createCheckpoint(): void {
    this.checkpoint = this.messages.slice();
    this.checkpointTokens = this.estimatedTokens;
  }

  restoreCheckpoint(): void {
    this.messages = this.checkpoint!.slice();
    this.estimatedTokens = this.checkpointTokens;
  }

  removeCheckpoint(): void {
    this.checkpoint = undefined;
    this.checkpointTokens = 0;
  }
}
