import type { Tool, ToolContext, ToolResult, ToolSchema } from "./types.js";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./fileRead.js";
import { fileWriteTool } from "./fileWrite.js";
import { fileEditTool } from "./fileEdit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./webFetch.js";
import { askUserTool } from "./askUser.js";
import { todoWriteTool } from "./todoWrite.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private schemasCache: ToolSchema[] | null = null;

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    this.schemasCache = null;
  }

  schemas(): ToolSchema[] {
    if (!this.schemasCache) {
      this.schemasCache = [...this.tools.values()].map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    return this.schemasCache;
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
    if (!tool) return "";
    if (tool.summarizeArgs) return tool.summarizeArgs(args);
    if (!tool.summaryArg) return "";
    const keys = Array.isArray(tool.summaryArg) ? tool.summaryArg : [tool.summaryArg];
    for (const k of keys) {
      const v = args[k];
      if (typeof v === "string" && v) return v;
    }
    return "";
  }
}

export interface BuiltinToolsOptions {
  askUser?: boolean;
  todoWrite?: boolean;
  disable?: string[];
}

export function registerBuiltinTools(tools: ToolRegistry, opts?: BuiltinToolsOptions) {
  const disable = opts?.disable;
  const builtins = [shellTool, fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool, webFetchTool];
  if (opts?.askUser) builtins.push(askUserTool);
  if (opts?.todoWrite) builtins.push(todoWriteTool);
  for (const t of builtins) {
    if (disable?.includes(t.name)) continue;
    tools.register(t);
  }
}
