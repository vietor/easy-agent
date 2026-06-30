import type { Tool, ToolResult } from "./types.js";
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

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { content: `Error: unknown tool ${name}`, isError: true };
    try {
      const r = await tool.execute(args);
      return typeof r === "string" ? { content: r } : r;
    } catch (e) {
      return { content: `Error: ${(e as Error).message}`, isError: true };
    }
  }

  summarize(name: string, args: Record<string, unknown>): string {
    const tool = this.tools.get(name);
    if (!tool?.summaryArg) return "";
    const keys = Array.isArray(tool.summaryArg) ? tool.summaryArg : [tool.summaryArg];
    for (const k of keys) {
      const v = args[k];
      if (typeof v === "string" && v) return v;
    }
    return "";
  }
}
