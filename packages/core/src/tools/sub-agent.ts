import { compactThresholdFor } from "../llm/client.js";
import { textOf, type LLMClient } from "../llm/types.js";
import type { ConversationMessage } from "../core/conversation.js";
import { DEFAULT_MAX_TURNS, DEFAULT_STALL_THRESHOLD, NOT_EXECUTED_PREFIX } from "../util/constants.js";
import { toolError, type Tool } from "./types.js";
import { ToolRegistry } from "./registry.js";
import { Agent } from "../core/agent.js";
import { Conversation } from "../core/conversation.js";
import { TOOL_USE_PROMPT } from "./prompt.js";

export const SUB_AGENT_GUIDANCE =
  '- Consider delegating to the SubAgent tool when the task matches an agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate and keep the conclusion, not the file dumps. type: "explore" — read-only search agent for broad fan-out searches (state the search breadth in the task); type: "plan" — software architect producing implementation plans. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you have delegated a search, do not also run it yourself — wait for the result. Issue at most 2 SubAgent calls per turn; multiple calls in the same turn run concurrently. Sub-agents are read-only and return only their final report, not intermediate steps — verify important results yourself. For large workloads with many independent items that would exceed the turn budget, split the items into chunks sized so each sub-agent can complete its chunk within its own loop budget, delegate one SubAgent per chunk, and run the remaining chunks in the following turns as results return. Instruct each sub-agent to report results per item in structured lines so you can consolidate.';

export interface SubAgentToolDeps {
  llm: LLMClient;
  tools: ToolRegistry;
  stallThreshold?: number;
  maxTurns?: number;
  compactThreshold?: number;
}

const EXPLORE_PROMPT = [
  "You are the Explore sub-agent — a read-only search agent for broad fan-out searches. Use it when answering means sweeping many files, directories, or naming conventions and the parent needs only the conclusion, not the file dumps. You read excerpts rather than whole files, so you locate code — you do not review or audit it. You are read-only: you must not modify any files.",
  "Guidelines:",
  '- If the parent stated a search breadth, match your effort to it: "medium" for moderate exploration, "very thorough" for multiple locations and naming conventions.',
  "- Use Grep and Glob to locate matches first, then read only the excerpts needed to extract the facts — not whole files.",
  "- Follow imports and call sites to trace definitions when the answer depends on how code connects.",
  "- Trust tool results as ground truth; do not guess file contents from memory.",
  "- If the task is ambiguous, state your assumptions explicitly.",
  '- Report in concise markdown: a summary of findings first, then details with file_path:line_number references, and a final "Bottom line" section with a direct answer to the task.',
  "- Keep the report proportionate to the question — typically 10-40 lines; extract key facts rather than pasting file contents.",
].join("\n");

const PLAN_PROMPT = [
  "You are the Plan sub-agent — a software architect. Produce a step-by-step implementation plan for the given task. Read the relevant code first to ground the plan in the actual code, then design the plan. You are read-only: you must not modify any files or implement anything.",
  "Guidelines:",
  "- First locate the relevant code: read the files the task mentions and confirm real function signatures, module structure, and existing conventions before planning.",
  "- Consider architectural trade-offs: note the alternative approaches and why the recommended one was chosen.",
  "- Output a numbered step-by-step plan in markdown. For each step give the file paths to create or modify, the function or type signatures involved, and a one-line rationale. Order steps by dependency.",
  "- Identify the critical files for implementation — the files the implementer must read first.",
  '- End with a short "Risks & open questions" section listing anything to verify during implementation.',
  '- End with a short "Verification" section: the commands, tests, or manual checks to run to confirm each step works.',
  "- Keep the plan concise — typically 20-50 lines.",
  "- Be specific and actionable; do not speculate beyond what you read.",
].join("\n");

const SUB_AGENT_DEFS = [
  {
    type: "explore",
    name: "Explore",
    description: "Read-only search agent for broad fan-out searches across the codebase or web; locate code via excerpts, does not review or audit.",
    systemPrompt: EXPLORE_PROMPT,
  },
  {
    type: "plan",
    name: "Plan",
    description: "Software architect that produces a step-by-step implementation plan grounded in the actual code.",
    systemPrompt: PLAN_PROMPT,
  },
] as const;

const TOOL_DESCRIPTION =
  'Run a dedicated sub-agent in its own nested loop — the only result you receive is its final report as text, not intermediate steps. type: "explore" — a read-only search agent for broad fan-out searches of the codebase or web; specify a search breadth in the task ("medium" for moderate exploration, "very thorough" for multiple locations and naming conventions). type: "plan" — a software architect that reads the relevant code first, then returns a step-by-step implementation plan identifying critical files and architectural trade-offs. Sub-agents are read-only and cannot ask questions, use skills, or spawn further sub-agents.';

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
          description: 'The sub-agent type to invoke: "explore" (read-only fan-out search) or "plan" (implementation plan).',
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
      subTools.registerAll(deps.tools.filter((t) => t.readOnly === true));

      const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
      const conversation = new Conversation(
        [def.systemPrompt, TOOL_USE_PROMPT, `- Turn budget: ${maxTurns} tool-calling turns per run.`].join("\n\n")
      );
      const subAgent = new Agent({
        llm: deps.llm,
        conversation,
        tools: subTools,
        cwd: ctx.cwd,
        setTodos: () => {},
        getTodos: () => [],
        stallThreshold: deps.stallThreshold ?? DEFAULT_STALL_THRESHOLD,
        maxTurns,
        compactThreshold: deps.compactThreshold ?? compactThresholdFor(deps.llm.maxInputTokens),
      });

      const status = await subAgent.run(task, undefined, ctx.signal);

      const messages = conversation.export();
      const report = lastAssistantText(messages) || `(sub-agent produced no final text; status ${status})`;
      if (status === "ok") return { content: report };
      const stallReason = status === "stalled"
        ? [...messages].reverse()
          .map((m) => m.content)
          .find((c): c is string => typeof c === "string" && c.startsWith(NOT_EXECUTED_PREFIX))
        : undefined;
      const suffix = stallReason ? ` ${stallReason}` : "";
      return { content: `Sub-agent "${type}" ended with status ${status}.${suffix}\n\n${report}`, isError: true };
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
