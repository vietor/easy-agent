import type { Tool, ToolContext, ToolResult, ToolSchema } from "./types.js";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file_read.js";
import { fileWriteTool } from "./file_write.js";
import { fileEditTool } from "./file_edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./web_fetch.js";
import { askUserTool } from "./ask_user.js";
import { todoWriteTool } from "./todo_write.js";

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

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { content: `Error: unknown tool ${name}`, isError: true };
    try {
      const r = await tool.execute(args, ctx);
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

export function registerBuiltinTools(tools: ToolRegistry) {
  for (const t of [shellTool, fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool, webFetchTool, askUserTool, todoWriteTool])
    tools.register(t);
}
