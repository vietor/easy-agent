import type { AssistantMessage, Message } from "../llm/types.js";

export type ConversationMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0,
    words = 0,
    rest = 0,
    inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk++;
      inWord = false;
    } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 39) {
      if (!inWord) {
        words++;
        inWord = true;
      }
    } else {
      if ((code & 0xfc00) === 0xd800 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++;
      rest++;
      inWord = false;
    }
  }
  return Math.ceil(cjk * 1.6 + words * 1.3 + rest * 0.3);
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
    const result: Message[] = new Array(this.messages.length + 1);
    result[0] = { role: "system", content: this.system };
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      result[i + 1] = m.role === "skill" ? { role: "user", name: m.name, content: m.content } : m;
    }
    return result;
  }

  export(): ConversationMessage[] {
    return this.messages.slice();
  }

  import(messages: ConversationMessage[]): void {
    this.messages = messages.slice();
    this.estimatedTokens = this.systemEstimateTokens
      + messages.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0);
    this.messagesSnapshot = undefined;
  }

  clear(): void {
    this.messages = [];
    this.estimatedTokens = this.systemEstimateTokens;
  }

  compact(summary: string): void {
    this.messages = [{ role: "assistant", content: summary }];
    this.estimatedTokens = this.systemEstimateTokens + estimateTokens(summary);
  }

  createSnapshot(): void {
    this.messagesSnapshot = this.messages.slice();
    this.estimatedTokensSnapshot = this.estimatedTokens;
  }

  restoreFromSnapshot(): void {
    const snap = this.messagesSnapshot;
    if (snap) {
      this.messages = snap.slice();
      this.estimatedTokens = this.estimatedTokensSnapshot;
    }
  }

  clearSnapshot(): void {
    this.messagesSnapshot = undefined;
    this.estimatedTokensSnapshot = 0;
  }
}
