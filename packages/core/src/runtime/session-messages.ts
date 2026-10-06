import { toText, type ImagePart, type LLMAssistantMessage, type LLMMessage } from "../llm/messages.js";
import {
  INTERRUPTED_TOOL_CONTENT,
  PRUNE_PROTECT_TOKENS,
  TOOL_OUTPUT_CLEARED_PREFIX,
} from "../util/constants.js";
import { estimateImageTokens } from "../util/file.js";
import { estimateTokens } from "../util/text.js";

export type SessionMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | LLMAssistantMessage
  | { role: "tool"; tool_call_id: string; content: string; resultSummary?: string; isError?: boolean; images?: ImagePart[] };

type ToolMessage = Extract<SessionMessage, { role: "tool" }>;

function clearedContent(message: ToolMessage): string {
  return `${TOOL_OUTPUT_CLEARED_PREFIX}${message.resultSummary ?? "tool output"})`;
}

function messageText(msg: SessionMessage): string {
  const parts: string[] = [];
  const t = toText(msg.content);
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

function messageTokens(msg: SessionMessage): number {
  const tokens = estimateTokens(messageText(msg));
  if (msg.role !== "tool" || !msg.images?.length) return tokens;
  let total = tokens;
  for (const image of msg.images) {
    total += estimateImageTokens(Buffer.from(image.data, "base64"));
  }
  return total;
}

function toLLMMessage(m: SessionMessage): LLMMessage {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.tool_call_id, content: m.content, ...(m.isError && { isError: true }), ...(m.images?.length && { images: m.images }) };
  }
  if (m.role === "skill") {
    const content = `Skill "${m.name}" invoked. Its instructions follow:\n\n${m.content}`;
    return { role: "user", name: m.name, content };
  }
  return m;
}

export class SessionMessages {
  private readonly systemEstimateTokens: number;

  private messages: SessionMessage[] = [];
  private estimatedTokens = 0;
  private llmCache: LLMMessage[] | null = null;

  constructor(private system: string) {
    this.systemEstimateTokens = estimateTokens(system);
    this.estimatedTokens = this.systemEstimateTokens;
  }

  getEstimatedTokens(): number {
    return this.estimatedTokens;
  }

  add(msg: SessionMessage): void {
    this.messages.push(msg);
    this.estimatedTokens += messageTokens(msg);
    if (this.llmCache) {
      this.llmCache.push(toLLMMessage(msg));
    }
  }

  toLLM(): LLMMessage[] {
    if (this.llmCache) {
      return this.llmCache.slice();
    }
    const result: LLMMessage[] = new Array(this.messages.length + 1);
    result[0] = { role: "system", content: this.system };
    for (let i = 0; i < this.messages.length; i++) {
      result[i + 1] = toLLMMessage(this.messages[i]);
    }
    this.llmCache = result;
    return result.slice();
  }

  export(): SessionMessage[] {
    return this.messages.slice();
  }

  lastAssistantText(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role !== "assistant") continue;
      const text = toText(m.content);
      if (text) return text;
    }
    return "";
  }

  import(messages: SessionMessage[]): void {
    this.resetMessages(
      messages.slice(),
      messages.reduce((sum, m) => sum + messageTokens(m), 0)
    );
    this.normalizeInterruptedToolCalls();
  }

  normalizeInterruptedToolCalls(): void {
    const out: SessionMessage[] = [];
    let changed = false;
    let addedTokens = 0;
    for (let i = 0; i < this.messages.length; i++) {
      const m = this.messages[i];
      out.push(m);
      if (m.role !== "assistant" || !m.tool_calls?.length) continue;
      const satisfied = new Set<string>();
      while (i + 1 < this.messages.length) {
        const next = this.messages[i + 1];
        if (next.role !== "tool") break;
        i++;
        out.push(next);
        satisfied.add(next.tool_call_id);
      }
      for (const tc of m.tool_calls) {
        if (satisfied.has(tc.id)) continue;
        out.push({
          role: "tool",
          tool_call_id: tc.id,
          content: INTERRUPTED_TOOL_CONTENT,
          resultSummary: INTERRUPTED_TOOL_CONTENT,
          isError: true,
        });
        changed = true;
        addedTokens += estimateTokens(INTERRUPTED_TOOL_CONTENT);
      }
    }
    if (changed) {
      this.messages = out;
      this.estimatedTokens += addedTokens;
      this.llmCache = null;
    }
  }

  pruneToolOutputs(minFreedTokens: number): number {
    const candidates: ToolMessage[] = [];
    let total = 0;
    let freed = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.role !== "tool") continue;
      const tokens = messageTokens(m);
      total += tokens;
      if (total <= PRUNE_PROTECT_TOKENS) continue;
      freed += tokens - estimateTokens(clearedContent(m));
      candidates.push(m);
    }
    if (freed <= minFreedTokens) return 0;

    for (const message of candidates) {
      message.content = clearedContent(message);
      message.images = undefined;
    }
    this.estimatedTokens -= freed;
    this.llmCache = null;
    return freed;
  }

  clear(): void {
    this.resetMessages([], 0);
  }

  compact(summary: string, keepTokens: number): void {
    let start = this.messages.length;
    let tokens = 0;
    while (start > 0 && tokens < keepTokens) {
      start--;
      tokens += messageTokens(this.messages[start]);
    }
    while (start < this.messages.length && this.messages[start].role === "tool") {
      tokens -= messageTokens(this.messages[start]);
      start++;
    }
    this.resetMessages(
      [{ role: "assistant", content: summary }, ...this.messages.slice(start)],
      estimateTokens(summary) + tokens
    );
  }

  private resetMessages(messages: SessionMessage[], extraTokens: number): void {
    this.messages = messages;
    this.estimatedTokens = this.systemEstimateTokens + extraTokens;
    this.llmCache = null;
  }

  skillMessage(name: string, content: string): Extract<SessionMessage, { role: "skill" }> {
    const known = this.messages.some((m) => m.role === "skill" && m.name === name && m.content === content);
    return {
      role: "skill",
      name,
      content: known ? `<skill "${name}" invoked - its instructions are already in context above>` : content,
    };
  }

}
