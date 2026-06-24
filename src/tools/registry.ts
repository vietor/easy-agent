import type { Tool } from "./types.js";
import type { ToolSchema } from "../llm/types.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: unknown tool ${name}`;
    try {
      return await tool.execute(args);
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  }
}
