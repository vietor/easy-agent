import type { LLMClient } from "../llm/client.js";
import type { Session } from "./session.js";
import type { ToolRegistry } from "../tools/registry.js";

export class Agent {
  constructor(
    private llm: LLMClient,
    private session: Session,
    private tools: ToolRegistry
  ) {}

  async run(userInput: string): Promise<string> {
    this.session.add({ role: "user", content: userInput });
    while (true) {
      const msg = await this.llm.chat(this.session.messages, this.tools.schemas());
      this.session.add(msg);
      if (!msg.tool_calls?.length) {
        return (msg.content as string) || "";
      }
      for (const call of msg.tool_calls) {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const result = await this.tools.execute(call.function.name, args);
        this.session.add({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }
  }
}
