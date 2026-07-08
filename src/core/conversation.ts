import type { AssistantMessage, Message } from "../llm/types.js";

export type ConversationMessage =
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

function messageText(msg: ConversationMessage): string {
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

export class Conversation {
  private readonly systemEstimateTokens: number;

  private messages: ConversationMessage[] = [];
  private estimatedTokens = 0;
  private messagesSnapshot?: ConversationMessage[];
  private estimatedTokensSnapshot = 0;

  constructor(private system: string) {
    this.systemEstimateTokens = estimateTokens(system);

    this.messages.push({ role: "system", content: system });
    this.estimatedTokens = this.systemEstimateTokens;
  }

  getEstimatedTokens(): number {
    return this.estimatedTokens;
  }

  add(msg: ConversationMessage): void {
    this.messages.push(msg);
    this.estimatedTokens += estimateTokens(messageText(msg));
  }

  toLLM(): Message[] {
    return this.messages.map((m) => (m.role === "skill" ? { role: "user", name: m.name, content: m.content } : m));
  }

  export(): ConversationMessage[] {
    return this.messages.slice(1);
  }

  clear(): void {
    this.messages = [{ role: "system", content: this.system }];
    this.estimatedTokens = this.systemEstimateTokens;
  }

  compact(summary: string): void {
    this.messages = [
      { role: "system", content: this.system },
      { role: "assistant", content: summary },
    ];
    this.estimatedTokens = estimateTokens(this.system) + estimateTokens(summary);
  }

  createSnapshot(): void {
    this.messagesSnapshot = this.messages.slice();
    this.estimatedTokensSnapshot = this.estimatedTokens;
  }

  restoreFromSnapshot(): void {
    if (this.messagesSnapshot) {
      this.messages = this.messagesSnapshot!.slice();
      this.estimatedTokens = this.estimatedTokensSnapshot;
    }
  }

  clearSnapshot(): void {
    this.messagesSnapshot = undefined;
    this.estimatedTokensSnapshot = 0;
  }
}
