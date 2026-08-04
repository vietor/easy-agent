import { compactThresholdFor } from "../llm/client.js";
import { textOf, type LLMClient } from "../llm/types.js";
import type { ConversationMessage } from "../core/conversation.js";
import { DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD } from "../util/constants.js";
import { toolError, type Tool } from "./types.js";
import { ToolRegistry } from "./registry.js";
import { Agent } from "../core/agent.js";
import { Conversation } from "../core/conversation.js";
import { TOOL_USE_PROMPT } from "./prompt.js";

export const SUB_AGENT_GUIDANCE = '- Consider delegating subtasks to a sub-agent via the SubAgent tool: type: "explore" to investigate the codebase or web, type: "plan" to produce an implementation plan, or type: "generic" to execute a task end-to-end with full tool access (shell, file read/write/edit, search, web fetch). The sub-agent runs silently and returns only its final report — verify important results yourself, especially for "generic" tasks that modify files.';

export interface SubAgentToolDeps {
  llm: LLMClient;
  tools: ToolRegistry;
  stallThreshold?: number;
  maxTurns?: number;
  compactThreshold?: number;
}

const READ_ONLY_SUB_AGENT_TOOLS = ["FileRead", "Glob", "Grep", "WebFetch"] as const;
const FULL_SUB_AGENT_TOOLS = ["Shell", "FileRead", "FileWrite", "FileEdit", "Glob", "Grep", "WebFetch"] as const;

const EXPLORE_PROMPT = [
  "You are the Explore sub-agent. Your job is to investigate and answer a question by reading files, searching the codebase, and fetching web pages. You are read-only: you must not modify any files.",
  "Guidelines:",
  "- Investigate thoroughly: read the relevant files, follow imports and call sites, and search for definitions before concluding.",
  "- Trust tool results as ground truth; do not guess file contents from memory.",
  "- If the task is ambiguous, state your assumptions explicitly.",
  '- Report in concise markdown: a summary of findings first, then details with file_path:line_number references, and a final "Bottom line" section with a direct answer to the task.',
  "- Keep the report proportionate to the question — typically 10-40 lines; extract key facts rather than pasting file contents.",
].join("\n");

const PLAN_PROMPT = [
  "You are the Plan sub-agent — a software architect. Produce a concrete, step-by-step implementation plan for the given task. You may read files and search the codebase to ground the plan in the actual code; you must not modify any files.",
  "Guidelines:",
  "- First locate the relevant code: read the files the task mentions and confirm real function signatures, module structure, and existing conventions before planning.",
  "- Output a numbered step-by-step plan in markdown. For each step give the file paths to create or modify, the function or type signatures involved, and a one-line rationale. Order steps by dependency.",
  '- End with a short "Risks & open questions" section listing anything to verify during implementation.',
  '- End with a short "Verification" section: the commands, tests, or manual checks to run to confirm each step works.',
  "- Keep the plan concise — typically 20-50 lines.",
  "- Be specific and actionable; do not speculate beyond what you read.",
].join("\n");

const GENERIC_PROMPT = [
  "You are the Generic sub-agent. Execute the given task end-to-end using the available tools: read and search files, create or edit files, run shell commands, and fetch web pages as needed. You are not read-only; modifying files and running commands is expected when the task requires it.",
  "Guidelines:",
  "- Break the task into concrete steps and work through them in order; check the result of each step before moving on.",
  "- Prefer the dedicated file tools (FileRead, FileWrite, FileEdit, Glob, Grep) over Shell for file operations; use Shell for commands (install, build, test, run) that no dedicated tool covers.",
  "- Trust tool output over memory. After writes or commands, verify the outcome when it matters — read the file back, run the tests, or check the command's output.",
  "- Respect every constraint the parent agent stated in the task: paths to touch, files to leave alone, formats, and any other instructions.",
  "- Do not ask questions or request user input; if something is genuinely ambiguous, state your assumption and proceed with the most reasonable choice.",
  '- Report in concise markdown: a summary of what you did, each file created or modified with a file_path:line reference, the commands you ran and their outcomes, verification results, and a final "Done" section that states the task is complete or lists exactly what remains unfinished.',
].join("\n");

const SUB_AGENT_DEFS = [
  {
    type: "explore",
    name: "Explore",
    description: "Investigate and answer questions about the codebase or the web.",
    systemPrompt: EXPLORE_PROMPT,
    tools: READ_ONLY_SUB_AGENT_TOOLS,
  },
  {
    type: "plan",
    name: "Plan",
    description: "Produce a step-by-step implementation plan for a task.",
    systemPrompt: PLAN_PROMPT,
    tools: READ_ONLY_SUB_AGENT_TOOLS,
  },
  {
    type: "generic",
    name: "Generic",
    description: "Execute a task end-to-end with full tool access (shell, file edit, search, web fetch).",
    systemPrompt: GENERIC_PROMPT,
    tools: FULL_SUB_AGENT_TOOLS,
  },
] as const;

const TOOL_DESCRIPTION =
  'Run a dedicated sub-agent in its own nested loop (silent — no events streamed to the UI). type: "explore" — investigate the codebase or web (read-only); "plan" — produce a step-by-step implementation plan (read-only); "generic" — execute a task end-to-end with full tool access (shell, file read/write/edit, search, web fetch; may modify files). Returns the sub-agent\'s final report as text. The sub-agent cannot ask questions, use skills, or spawn further sub-agents.';

export function createSubAgentTool(deps: SubAgentToolDeps): Tool {
  return {
    name: "SubAgent",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: SUB_AGENT_DEFS.map((d) => d.type),
          description: 'Which sub-agent to invoke: "explore" (investigate), "plan" (design an implementation plan), or "generic" (execute a task end-to-end).',
        },
        task: { type: "string", description: "The task or question for the sub-agent, as a self-contained description." },
      },
      required: ["type", "task"],
    },
    summaryArg: "type",
    async execute(args, ctx) {
      const type = args.type as string;
      const task = ((args.task as string) ?? "").trim();
      const def = SUB_AGENT_DEFS.find((d) => d.type === type);
      if (!def) {
        return toolError(`unknown sub-agent type "${type}". Valid types: ${SUB_AGENT_DEFS.map((d) => d.type).join(", ")}`);
      }
      if (!task) {
        return toolError("task is required");
      }

      const subTools = new ToolRegistry();
      for (const name of def.tools) {
        const tool = deps.tools.get(name);
        if (tool) subTools.register(tool);
      }

      const conversation = new Conversation([def.systemPrompt, TOOL_USE_PROMPT].join("\n\n"));
      const subAgent = new Agent({
        llm: deps.llm,
        conversation,
        tools: subTools,
        cwd: ctx.cwd,
        setTodos: () => {},
        getTodos: () => [],
        stallThreshold: deps.stallThreshold ?? DEFAULT_STALL_THRESHOLD,
        maxTurns: deps.maxTurns ?? DEFAULT_MAX_TURNS,
        compactThreshold: deps.compactThreshold ?? compactThresholdFor(deps.llm.contextWindow),
      });

      const status = await subAgent.run(task, undefined, ctx.signal);

      const report = lastAssistantText(conversation.export()) || `(sub-agent produced no final text; status ${status})`;
      return status === "ok"
        ? { content: report }
        : { content: `Sub-agent "${type}" ended with status ${status}.\n\n${report}`, isError: true };
    },
  };
}

function lastAssistantText(messages: ConversationMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = textOf(m.content);
    if (text) return text;
  }
  return "";
}
