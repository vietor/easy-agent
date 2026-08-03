import { toolError, type Tool, type ToolContext, type ToolResult, type ToolSchema } from "./types.js";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { fileEditTool } from "./file-edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./web-fetch.js";
import { MAX_PREVIEW_LEN } from "../util/constants.js";
import { timeFormat, compactFormat, getTextBytes, ellipsisText } from "../util/text.js";

function defaultPreview(result: ToolResult): string {
  if (result.isError) {
    return ellipsisText(result.content, MAX_PREVIEW_LEN);
  }
  const bytes = getTextBytes(result.content);
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
    this.schemasCache = null;
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
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

  unregister(name: string): void {
    if (this.tools.delete(name)) {
      this.schemasCache = null;
    }
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return toolError(`unknown tool ${name}`);
    try {
      const r = await tool.execute(args, ctx);
      return typeof r === "string" ? { content: r } : r;
    } catch (e) {
      return toolError(e instanceof Error ? e.message : String(e));
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
    const parts: string[] = [];
    const keys = Array.isArray(tool.summaryArg) ? tool.summaryArg : [tool.summaryArg];
    for (const k of keys) {
      const v = args[k];
      if (typeof v === "string" && v) {
        parts.push(v);
      }
    }
    return parts.join(" ");
  }
}

export interface BuiltinToolsOptions {
  /** Tools to disable, by lowercase-camelCase name (e.g. "shell", "fileRead"). AskUser, TodoWrite, Skill and SubAgent are toggled by their own flags and cannot be disabled here. */
  disabled?: string[];
  askUser?: boolean;
  todoWrite?: boolean;
  skill?: boolean;
  subAgent?: boolean;
}

const CORE_TOOLS: Tool[] = [shellTool, fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool, webFetchTool];

function toolKey(tool: Tool): string {
  return tool.name[0].toLowerCase() + tool.name.slice(1);
}

export function registerBuiltinTools(tools: ToolRegistry, opts?: BuiltinToolsOptions) {
  const disabled = new Set(opts?.disabled ?? []);
  for (const tool of CORE_TOOLS) {
    if (disabled.has(toolKey(tool))) continue;
    tools.register(tool);
  }
}
