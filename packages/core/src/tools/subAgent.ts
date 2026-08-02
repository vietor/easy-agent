import { compactThresholdFor, textOf, type LLMClient } from "../llm/types.js";
import type { ConversationMessage } from "../core/conversation.js";
import type { Tool } from "./types.js";
import { ToolRegistry } from "./registry.js";
import { Agent } from "../core/agent.js";
import { Conversation } from "../core/conversation.js";
import { TOOL_USE_PROMPT } from "./prompt.js";

export type SubAgentType = "explore" | "plan";

export interface SubAgentDef {
  type: SubAgentType;
  name: string;
  description: string;
  systemPrompt: string;
}

export interface SubAgentToolDeps {
  llm: LLMClient;
  tools: ToolRegistry;
  subAgents?: readonly SubAgentDef[];
  maxTurns?: number;
}

/** Read-only tools available inside a sub-agent loop. SubAgent itself is absent, so recursion is impossible. */
const SUB_AGENT_TOOLS = ["FileRead", "Glob", "Grep", "WebFetch", "Shell"] as const;

const EXPLORE_PROMPT = [
  "You are the Explore sub-agent. Your job is to investigate and answer a question by reading files, searching the codebase, and fetching web pages. You are read-only: you must not modify any files.",
  "Guidelines:",
  "- Investigate thoroughly: read the relevant files, follow imports and call sites, and search for definitions before concluding.",
  "- Trust tool results as ground truth; do not guess file contents from memory.",
  "- Use Shell only for read-only inspection commands (e.g. ls, git log, git status); never run commands that modify files or system state.",
  "- If the task is ambiguous, state your assumptions explicitly.",
  '- Report in concise markdown: a summary of findings first, then details with file_path:line_number references, and a final "Bottom line" section with a direct answer to the task.',
].join("\n");

const PLAN_PROMPT = [
  "You are the Plan sub-agent — a software architect. Produce a concrete, step-by-step implementation plan for the given task. You may read files and search the codebase to ground the plan in the actual code; you must not modify any files.",
  "Guidelines:",
  "- First locate the relevant code: read the files the task mentions and confirm real function signatures, module structure, and existing conventions before planning.",
  "- Output a numbered step-by-step plan in markdown. For each step give the file paths to create or modify, the function or type signatures involved, and a one-line rationale. Order steps by dependency.",
  '- End with a short "Risks & open questions" section listing anything to verify during implementation.',
  "- Be specific and actionable; do not speculate beyond what you read.",
].join("\n");

export const SUB_AGENT_DEFS: readonly SubAgentDef[] = [
  {
    type: "explore",
    name: "Explore",
    description: "Investigate and answer questions about the codebase or the web.",
    systemPrompt: EXPLORE_PROMPT,
  },
  {
    type: "plan",
    name: "Plan",
    description: "Produce a step-by-step implementation plan for a task.",
    systemPrompt: PLAN_PROMPT,
  },
];

const TOOL_DESCRIPTION =
  'Run a dedicated sub-agent in its own nested loop (silent — no events streamed to the UI). The sub-agent can only read files, search, fetch URLs, and run read-only shell commands; it cannot write or edit files and cannot ask questions. Returns the sub-agent\'s final report as text. type: "explore" — investigate and answer questions about the codebase or web; "plan" — produce a step-by-step implementation plan.';

export function createSubAgentTool(deps: SubAgentToolDeps): Tool {
  const defs = deps.subAgents ?? SUB_AGENT_DEFS;
  return {
    name: "SubAgent",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: defs.map((d) => d.type),
          description: 'Which sub-agent to invoke: "explore" (investigate) or "plan" (design an implementation plan).',
        },
        task: { type: "string", description: "The task or question for the sub-agent, as a self-contained description." },
      },
      required: ["type", "task"],
    },
    summaryArg: "type",
    async execute(args, ctx) {
      const type = args.type as string;
      const task = ((args.task as string) ?? "").trim();
      const def = defs.find((d) => d.type === type);
      if (!def) {
        return { content: `Error: unknown sub-agent type "${type}". Valid types: ${defs.map((d) => d.type).join(", ")}`, isError: true };
      }
      if (!task) {
        return { content: "Error: task is required", isError: true };
      }

      const subTools = new ToolRegistry();
      for (const name of SUB_AGENT_TOOLS) {
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
        stallThreshold: 3,
        maxTurns: deps.maxTurns ?? 20,
        compactThreshold: compactThresholdFor(deps.llm.contextWindow),
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
