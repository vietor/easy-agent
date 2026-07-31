import type { Tool, ToolContext, ToolResult, ToolSchema } from "./types.js";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./fileRead.js";
import { fileWriteTool } from "./fileWrite.js";
import { fileEditTool } from "./fileEdit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./webFetch.js";
import { timeFormat, compactFormat, getContentBytes  } from "../util/text.js";

function defaultPreview(result: ToolResult): string {
  if (result.isError) {
    const text = result.content.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return text.length > 75 ? text.slice(0, 75) + "…" : text;
  }
  const bytes = getContentBytes(result.content);
  const lines = result.content === "" ? 0 : (result.content.match(/\n/g) || []).length + 1;
  return `Retrieved ${compactFormat(bytes)} bytes, ${compactFormat(lines)} lines`;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private schemasCache: ToolSchema[] | null = null;

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    this.schemasCache = null;
    return this;
  }

  registerAll(tools: Tool[]): this {
    for (const t of tools) this.tools.set(t.name, t);
    this.schemasCache = null; // invalidate once, not N times
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
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

  getPreview(name: string, result: ToolResult, durationMs?: number): string {
    const tool = this.tools.get(name);
    const preview = tool?.getPreview
      ? tool.getPreview(result)
      : defaultPreview(result);
    return durationMs !== undefined
      ? `[${timeFormat(durationMs / 1000)}] ${preview}`
      : preview;
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
  shell?: boolean;
  fileRead?: boolean;
  fileWrite?: boolean;
  fileEdit?: boolean;
  glob?: boolean;
  grep?: boolean;
  webFetch?: boolean;
  askUser?: boolean;
  todoWrite?: boolean;
  skill?: boolean;
}

const CORE_TOOLS: Tool[] = [shellTool, fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool, webFetchTool];

function optionKey(tool: Tool): keyof BuiltinToolsOptions {
  return (tool.name[0].toLowerCase() + tool.name.slice(1)) as keyof BuiltinToolsOptions;
}

export function registerBuiltinTools(tools: ToolRegistry, opts?: BuiltinToolsOptions) {
  for (const tool of CORE_TOOLS) {
    if (opts?.[optionKey(tool)] === false) continue;
    tools.register(tool);
  }
}
