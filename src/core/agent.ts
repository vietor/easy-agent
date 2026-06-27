import type { LLMClient } from "../llm/client.js";
import type { Message } from "../llm/types.js";
import type { Session } from "./session.js";
import type { ToolRegistry } from "../tools/registry.js";

const STALL_THRESHOLD = 3;

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string; summary: string }
  | { type: "tool_end"; name: string; result: string };

export class Agent {
  constructor(
    private llm: LLMClient,
    private session: Session,
    private tools: ToolRegistry
  ) {}

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
      { role: "user", content: "Summarize this conversation into a concise context summary. Preserve the user's goal, decisions made, files touched, and current progress. Write the summary in the same language the user used in the conversation. Begin your reply with \"Summary of conversation so far:\"." },
    ];
    const msg = await this.llm.chat(request, []);
    this.session.compact((msg.content as string) || "");
  }

  async run(userInput: string, onEvent?: (e: AgentEvent) => void): Promise<string> {
    this.session.add({ role: "user", content: userInput });
    let lastSignature = "";
    let stallCount = 0;
    while (true) {
      const msg = await this.llm.chat(
        this.session.messages,
        this.tools.schemas(),
        (text) => onEvent?.({ type: "delta", text })
      );
      this.session.add(msg);
      if (!msg.tool_calls?.length) {
        return (msg.content as string) || "";
      }
      const signature = msg.tool_calls
        .map((c) => `${c.function.name}:${c.function.arguments}`)
        .join("|");
      if (signature === lastSignature) {
        if (++stallCount >= STALL_THRESHOLD) {
          return `Error: agent stalled: repeated identical tool calls`;
        }
      } else {
        lastSignature = signature;
        stallCount = 1;
      }
      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        let parseError: string | null = null;
        if (call.function.arguments) {
          try {
            args = JSON.parse(call.function.arguments);
          } catch (e) {
            parseError = `Error: invalid arguments: ${(e as Error).message}`;
          }
        }
        const summary = this.tools.summarize(call.function.name, args);
        onEvent?.({ type: "tool_start", name: call.function.name, summary });
        const result = parseError ?? await this.tools.execute(call.function.name, args);
        onEvent?.({ type: "tool_end", name: call.function.name, result });
        this.session.add({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }
  }
}
