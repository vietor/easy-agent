import type { Message } from "../llm/types.js";

function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const words = (text.match(/[a-zA-Z0-9']+/g) || []).length;
  return Math.ceil((cjk * 1.6) + (words * 1.3) + ((text.length - cjk) * 0.3));
}

function messageText(msg: Message): string {
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
  messages: Message[] = [];
  estimatedTokens = 0;
  private checkpoint?: Message[];
  private checkpointTokens = 0;

  constructor(private system: string) {
    this.messages.push({ role: "system", content: system });
    this.estimatedTokens = estimateTokens(system);
  }

  add(msg: Message): void {
    this.messages.push(msg);
    this.estimatedTokens += estimateTokens(messageText(msg));
  }

  export(): Message[] {
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
