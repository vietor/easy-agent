import type { LLMClient } from "../llm/client.js";
import type { Session } from "./session.js";
import type { ToolRegistry } from "../tools/registry.js";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string };

export class Agent {
  constructor(
    private llm: LLMClient,
    private session: Session,
    private tools: ToolRegistry
  ) {}

  async run(userInput: string, onEvent?: (e: AgentEvent) => void): Promise<string> {
    this.session.add({ role: "user", content: userInput });
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
      for (const call of msg.tool_calls) {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        onEvent?.({ type: "tool_start", name: call.function.name, args });
        const result = await this.tools.execute(call.function.name, args);
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
