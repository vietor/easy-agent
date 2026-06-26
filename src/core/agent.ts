import type { LLMClient } from "../llm/client.js";
import type { Session } from "./session.js";
import type { ToolRegistry } from "../tools/registry.js";

const MAX_ITERATIONS = 25;

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

  async run(userInput: string, onEvent?: (e: AgentEvent) => void): Promise<string> {
    this.session.add({ role: "user", content: userInput });
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const msg = await this.llm.chat(
        this.session.messages,
        this.tools.schemas(),
        (text) => onEvent?.({ type: "delta", text })
      );
      this.session.add(msg);
      if (!msg.tool_calls?.length) {
        return (msg.content as string) || "";
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
    return `Error: agent exceeded max iterations: ${MAX_ITERATIONS}`;
  }
}
