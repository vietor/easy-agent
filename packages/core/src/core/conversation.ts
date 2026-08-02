import { textOf, type AssistantMessage, type Message } from "../llm/types.js";
import { getTextBytes } from "../util/text.js";

export type ConversationMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string; preview?: string; isError?: boolean };

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.round(getTextBytes(text) / 4);
}

function messageText(msg: ConversationMessage): string {
  const parts: string[] = [];
  const t = textOf(msg.content);
  if (t) parts.push(t);
  if ("tool_calls" in msg && msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      if (tc.function?.name) parts.push(tc.function.name);
      if (tc.function?.arguments) parts.push(tc.function.arguments);
    }
  }
  if ("thinking" in msg && msg.thinking) {
    for (const t of msg.thinking) {
      if (t.type === "thinking") parts.push(t.thinking);
    }
  }
  return parts.join(" ");
}

function toLLMMessage(m: ConversationMessage): Message {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  if (m.role === "skill") return { role: "user", name: m.name, content: m.content };
  return m;
}

export class Conversation {
  private readonly systemEstimateTokens: number;

  private messages: ConversationMessage[] = [];
  private estimatedTokens = 0;
  private collapsedCount = 0;
  private messagesSnapshot?: ConversationMessage[];
  private estimatedTokensSnapshot = 0;
  private collapsedCountSnapshot = 0;
  private llmCache: Message[] | null = null;

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
    if (this.llmCache) {
      this.llmCache.push(toLLMMessage(msg));
    }
  }

  toLLM(): Message[] {
    if (this.llmCache) {
      return this.llmCache.slice();
    }
    const result: Message[] = new Array(this.messages.length + 1);
    result[0] = { role: "system", content: this.system };
    for (let i = 0; i < this.messages.length; i++) {
      result[i + 1] = toLLMMessage(this.messages[i]);
    }
    this.llmCache = result;
    return result.slice();
  }

  export(): ConversationMessage[] {
    return this.messages.slice();
  }

  import(messages: ConversationMessage[]): void {
    this.resetMessages(
      messages.slice(),
      messages.reduce((sum, m) => sum + estimateTokens(messageText(m)), 0)
    );
  }

  clear(): void {
    this.resetMessages([], 0);
  }

  compact(summary: string): void {
    this.resetMessages([{ role: "assistant", content: summary }], estimateTokens(summary));
  }

  private resetMessages(messages: ConversationMessage[], extraTokens: number): void {
    this.messages = messages;
    this.estimatedTokens = this.systemEstimateTokens + extraTokens;
    this.collapsedCount = 0;
    this.clearSnapshot();
    this.llmCache = null;
  }

  collapseSkills(): void {
    for (let i = this.collapsedCount; i < this.messages.length; i++) {
      const m = this.messages[i];
      if (m.role === "skill") this.collapseOne(m);
    }
    this.collapsedCount = this.messages.length;
  }

  private collapseOne(m: Extract<ConversationMessage, { role: "skill" }>): void {
    const before = estimateTokens(messageText(m));
    m.content = `<skill "${m.name}" invoked - its instructions were followed above>`;
    this.estimatedTokens += estimateTokens(messageText(m)) - before;
    this.llmCache = null;
  }

  createSnapshot(): void {
    this.messagesSnapshot = this.messages.slice();
    this.estimatedTokensSnapshot = this.estimatedTokens;
    this.collapsedCountSnapshot = this.collapsedCount;
  }

  restoreFromSnapshot(): void {
    const snap = this.messagesSnapshot;
    if (snap) {
      this.messages = snap.slice();
      this.estimatedTokens = this.estimatedTokensSnapshot;
      this.collapsedCount = this.collapsedCountSnapshot;
      this.clearSnapshot();
      this.llmCache = null;
    }
  }

  clearSnapshot(): void {
    this.messagesSnapshot = undefined;
    this.estimatedTokensSnapshot = 0;
    this.collapsedCountSnapshot = 0;
  }
}
