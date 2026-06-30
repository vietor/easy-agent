import { withAbort } from "../util/async.js";
import type { LLMClient } from "../llm/client.js";
import type { AssistantMessage, Message } from "../llm/types.js";
import type { Session } from "./session.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolResult } from "../tools/types.js";

const STALL_THRESHOLD = 3;

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "retry"; attempt: number; max: number }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; name: string; result: string; isError?: boolean }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "usage"; promptTokens: number; completionTokens: number };

const COMPACT_PROMPT = "Summarize this conversation into a concise context summary. Preserve the user's goal, decisions made, files touched, and current progress. Write the summary in the same language the user used in the conversation. Begin your reply with \"Summary of conversation so far:\".";

export class Agent {
  constructor(
    private llm: LLMClient,
    private session: Session,
    private tools: ToolRegistry
  ) {}

  get contextTokens(): number {
    return this.session.estimatedTokens;
  }

  clear(): void {
    this.session.clear();
  }

  export(): Message[] {
    return this.session.export();
  }

  async compact(): Promise<void> {
    const history = this.session.messages.slice(1);
    if (history.length === 0) return;
    const request: Message[] = [
      ...history,
      { role: "user", content: COMPACT_PROMPT },
    ];
    const msg = await this.llm.chat(request, []);
    this.session.compact((msg.content as string) || "");
  }

  async run(
    userInput: string,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    this.session.createCheckpoint();
    try {
      this.session.add({ role: "user", content: userInput });
      await withAbort(
        async (aborted) => {
          let lastSig = "";
          let stall = 0;
          while (true) {
            let msg: AssistantMessage;
            try {
              msg = await this.llm.chat(
                this.session.messages,
                this.tools.schemas(),
                (text) => onEvent?.({ type: "delta", text }),
                (attempt, max) => onEvent?.({ type: "retry", attempt, max }),
                (promptTokens, completionTokens) => onEvent?.({ type: "usage", promptTokens, completionTokens }),
                signal
              );
            } catch (e) {
              if (aborted()) return;
              onEvent?.({ type: "error", text: (e as Error).message });
              return;
            }
            this.session.add(msg);
            if (!msg.tool_calls?.length) return;
            if (aborted()) return;
            const sig = msg.tool_calls
              .map((c) => `${c.function.name}:${c.function.arguments}`)
              .join("|");
            stall = sig === lastSig ? stall + 1 : 1;
            lastSig = sig;
            if (stall >= STALL_THRESHOLD) {
              onEvent?.({ type: "error", text: "agent stalled: repeated identical tool calls" });
              return;
            }
            await Promise.all(
              msg.tool_calls.map(async (call) => {
                let args: Record<string, unknown> = {};
                let argsError = "";
                if (call.function.arguments) {
                  try { args = JSON.parse(call.function.arguments); }
                  catch (e) { argsError = `Error: invalid arguments: ${(e as Error).message}`; }
                }
                const summary = this.tools.summarize(call.function.name, args);
                onEvent?.({ type: "tool_start", id: call.id, name: call.function.name, summary });
                if (aborted()) return;
                const result: ToolResult = argsError
                  ? { content: argsError, isError: true }
                  : await this.tools.execute(call.function.name, args);
                if (aborted()) return;
                onEvent?.({ type: "tool_end", id: call.id, name: call.function.name, result: result.content, isError: result.isError });
                this.session.add({ role: "tool", tool_call_id: call.id, content: result.content });
              })
            );
            if (aborted()) return;
          }
        },
        {
          signal,
          onAbort: () => {
            this.session.restoreCheckpoint();
            onEvent?.({ type: "interrupted" });
          },
        }
      );
    } finally {
      this.session.removeCheckpoint();
    }
  }
}
