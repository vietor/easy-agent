import { toolError, type Tool, type ToolContext, type ToolResult, type ToolSchema, type Todo } from "./types.js";
import { shellTool } from "./shell.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { fileEditTool } from "./file-edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { webFetchTool } from "./web-fetch.js";
import { createAskUserTool } from "./ask-user.js";
import { createSkillTool } from "./skill.js";
import { createTodoWriteTool } from "./todo-write.js";
import { createSubAgentTool } from "./sub-agent.js";
import type { Skill } from "../skills/types.js";
import type { LLMClient } from "../llm/types.js";
import { MAX_PREVIEW_LEN } from "../util/constants.js";
import { errorMessage, timeFormat, compactFormat, getTextBytes, ellipsisText, lineCount } from "../util/text.js";

function defaultPreview(result: ToolResult): string {
  if (result.isError) {
    return ellipsisText(result.content, MAX_PREVIEW_LEN);
  }
  const bytes = getTextBytes(result.content);
  const lines = lineCount(result.content);
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

  filter(predicate: (t: Tool) => boolean): Tool[] {
    return [...this.tools.values()].filter(predicate);
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
      return toolError(errorMessage(e));
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
  readOnly?: boolean;
  askUser?: boolean;
  todoWrite?: boolean;
  subAgent?: boolean;
}

export interface BuiltinToolsDeps {
  ask: (question: string, options: string[]) => Promise<string>;
  setTodos: (todos: Todo[]) => void;
  resolveSkill?: (name: string) => Skill | undefined;
  subAgent: { llm: LLMClient; stallThreshold?: number; maxTurns?: number; compactThreshold?: number };
}

const BUILTIN_TOOLS: Tool[] = [fileReadTool, globTool, grepTool, webFetchTool, shellTool, fileWriteTool, fileEditTool];

export function registerBuiltinTools(tools: ToolRegistry, opts: BuiltinToolsOptions | false | undefined, deps: BuiltinToolsDeps) {
  if (opts === false) return;
  const builtins = opts?.readOnly ? BUILTIN_TOOLS.filter((t) => t.readOnly) : BUILTIN_TOOLS;
  for (const tool of builtins) {
    tools.register(tool);
  }
  if (opts?.askUser) tools.register(createAskUserTool(deps.ask));
  if (opts?.todoWrite) tools.register(createTodoWriteTool(deps.setTodos));
  if (deps.resolveSkill) tools.register(createSkillTool(deps.resolveSkill));
  if (opts?.subAgent) tools.register(createSubAgentTool({ registry: tools, ...deps.subAgent }));
}
