import type { Tool, ToolContext, ToolSchema, Todo } from "./types.js";
import { toolError } from "../util/types.js";
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
import { createSubAgentTool, type SubAgentToolDeps } from "./sub-agent.js";
import type { Skill } from "../skills/types.js";
import { MAX_ARGS_SUMMARY_LENGTH, MAX_SUMMARY_LENGTH } from "../util/constants.js";
import { errorMessage, formatSeconds, formatCompactNumber, getTextBytes, ellipsisText } from "../util/text.js";
import type { TextResult } from "../util/types.js";

function lineCount(content: string): number {
  return content === "" ? 0 : (content.match(/\n/g) || []).length + 1;
}

function defaultResultSummary(result: TextResult): string {
  if (result.isError) {
    return ellipsisText(result.content, MAX_SUMMARY_LENGTH);
  }
  const bytes = getTextBytes(result.content);
  const lines = lineCount(result.content);
  return `Retrieved ${formatCompactNumber(bytes)} bytes, ${formatCompactNumber(lines)} lines`;
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

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<TextResult> {
    const tool = this.tools.get(name);
    if (!tool) return toolError(`unknown tool ${name}`);
    try {
      return await tool.execute(args, ctx);
    } catch (e) {
      return toolError(errorMessage(e));
    }
  }

  summarizeResult(name: string, result: TextResult, durationMs?: number): string {
    const tool = this.tools.get(name);
    const resultSummary = tool?.summarizeResult
      ? tool.summarizeResult(result)
      : defaultResultSummary(result);
    return durationMs !== undefined
      ? `[${formatSeconds(durationMs / 1000)}] ${resultSummary}`
      : resultSummary;
  }

  summarizeArgs(name: string, args: Record<string, unknown>): string {
    const tool = this.tools.get(name);
    if (!tool) return "";
    if (tool.summarizeArgs) return tool.summarizeArgs(args);
    if (!tool.summaryKeys) return "";
    const parts: string[] = [];
    for (const k of tool.summaryKeys) {
      const v = args[k];
      if (typeof v === "string" && v) {
        parts.push(v);
      }
    }
    return ellipsisText(parts.join(" "), MAX_ARGS_SUMMARY_LENGTH, true);
  }
}

export interface BuiltInToolsOptions {
  readOnly?: boolean;
  askUser?: boolean;
  todoWrite?: boolean;
  subAgent?: boolean;
}

export interface BuiltInToolsDeps {
  ask: (question: string, options: string[]) => Promise<string>;
  setTodos: (todos: Todo[]) => void;
  resolveSkill?: (name: string) => Skill | undefined;
  subAgent: Omit<SubAgentToolDeps, "tools">;
}

const BUILTIN_TOOLS: Tool[] = [fileReadTool, globTool, grepTool, webFetchTool, shellTool, fileWriteTool, fileEditTool];

export function registerBuiltinTools(tools: ToolRegistry, opts: BuiltInToolsOptions | false | undefined, deps: BuiltInToolsDeps) {
  if (opts === false) return;
  const builtins = opts?.readOnly ? BUILTIN_TOOLS.filter((t) => t.readOnly) : BUILTIN_TOOLS;
  for (const tool of builtins) {
    tools.register(tool);
  }
  if (opts?.askUser) tools.register(createAskUserTool(deps.ask));
  if (opts?.todoWrite) tools.register(createTodoWriteTool(deps.setTodos));
  if (deps.resolveSkill) tools.register(createSkillTool(deps.resolveSkill));
  if (opts?.subAgent) tools.register(createSubAgentTool({ tools, ...deps.subAgent }));
}
