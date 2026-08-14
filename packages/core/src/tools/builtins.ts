import type { Tool, Todo } from "./types.js";
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
import type { ToolRegistry } from "./registry.js";

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
  subAgent: SubAgentToolDeps;
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
  if (opts?.subAgent) tools.register(createSubAgentTool(deps.subAgent));
}
