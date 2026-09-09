import { NOT_EXECUTED_PREFIX } from "../util/constants.js";
import { summarizeText } from "../util/text.js";
import type { SubAgentRunResult } from "../runtime/sub-agent-runner.js";
import { isGrantedAtLevel, type AgentLevel, type Tool } from "./types.js";
import { toolError } from "./types.js";

const MAX_LABEL_LENGTH = 50;

export interface SubAgentToolDeps {
  runSubAgent: (systemPrompt: string, task: string, level: AgentLevel, signal?: AbortSignal) => Promise<SubAgentRunResult>;
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
  "- Keep the reply proportionate to the question — typically 10-40 lines; extract key facts rather than pasting file contents.",
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

const GENERAL_PROMPT = [
  "You are the General sub-agent — the catch-all agent that researches questions and executes multi-step implementation tasks. Unlike explore and plan, you may modify files and run shell commands, so the parent delegates whole chunks of work to you.",
  "Guidelines:",
  "- If the parent assigned several items in one task, complete them all and report per item in structured lines so the parent can consolidate the batch.",
  "- Work only within the scope the parent assigned. Sibling sub-agents may be running in parallel on other chunks — do not touch files in their assigned areas; if the parent did not assign disjoint areas, call that out in your report.",
  "- You cannot ask the user questions, use skills or todos, or spawn further sub-agents. If a user decision or missing input genuinely blocks you, stop and report the decision point in your final reply instead of guessing.",
  "- Verify your own changes before finishing: re-read the edited files or run the relevant build/tests via Shell.",
  "- Trust tool results as ground truth; do not guess file contents from memory.",
  "- The parent receives only this final report and will re-check important results — report exactly what you changed (file paths), what verification you ran, and what remains open.",
  "- Keep the reply proportionate to the work — typically 15-60 lines.",
].join("\n");

const SUB_AGENT_DEFS = [
  {
    type: "explore",
    name: "Explore",
    level: 1,
    description: 'read-only search agent for broad fan-out searches across the codebase or web; specify the search breadth in the task ("medium" for moderate exploration, "very thorough" for multiple locations and naming conventions)',
    systemPrompt: EXPLORE_PROMPT,
  },
  {
    type: "plan",
    name: "Plan",
    level: 1,
    description: "read-only software architect that reads the relevant code first, then returns a step-by-step implementation plan identifying the critical files and architectural trade-offs",
    systemPrompt: PLAN_PROMPT,
  },
  {
    type: "general",
    name: "General",
    level: 2,
    description: "writable catch-all executor that may modify files and run shell commands to complete entire implementation chunks, reporting what it changed",
    systemPrompt: GENERAL_PROMPT,
  },
] as const;

type SubAgentDef = (typeof SUB_AGENT_DEFS)[number];

function defsForSession(readOnlySession: boolean): SubAgentDef[] {
  return SUB_AGENT_DEFS.filter((d) => isGrantedAtLevel(d.level, readOnlySession ? 1 : 2));
}

function describeTypes(defs: readonly SubAgentDef[]): string {
  return defs.map((d) => `type: "${d.type}" — ${d.description}`).join(" ");
}

const MAX_SUB_AGENTS_PER_TURN = 8;

export function renderSubAgentGuidance(readOnlySession: boolean, maxParallelToolCalls: number): string {
  const defs = defsForSession(readOnlySession);
  const maxPerTurn = Math.max(1, Math.min(MAX_SUB_AGENTS_PER_TURN, maxParallelToolCalls));
  const capSentence = maxPerTurn > 1
    ? `Multiple SubAgent calls in the same turn run concurrently; issue at most ${maxPerTurn} SubAgent calls per turn.`
    : "Issue at most 1 SubAgent call per turn.";
  const bullets = [
    `- Delegate to SubAgent when the task matches an agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate and keep the conclusion, not the file dumps. Valid type values: ${describeTypes(defs)}. Never use any other value. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you have delegated a search, do not also run it yourself — wait for the result.`,
    `- ${capSentence} For large workloads with many independent items, split the items into chunks sized so each sub-agent can complete its chunk within its own loop budget, delegate one SubAgent per chunk, and run the remaining chunks in the following turns as results return. Instruct each sub-agent to report results per item in structured lines so you can consolidate.`,
  ];
  if (readOnlySession) {
    bullets.push("- Sub-agents are read-only and return only their final report, not intermediate steps — verify important results yourself.");
    return bullets.join("\n");
  }
  bullets.push(
    '- Assign disjoint files to parallel "general" sub-agents: chunk by file area or module, and never delegate overlapping edits to different sub-agents in the same batch.',
    '- "explore" and "plan" sub-agents are read-only, but "general" sub-agents change your working tree and return only their final report, not intermediate steps — never mark a delegated task done on the report alone. Verify the changes yourself: read the diffs and run the relevant tests before reporting completion.'
  );
  return bullets.join("\n");
}

export function createSubAgentTool(deps: SubAgentToolDeps, readOnlySession = false): Tool {
  const defs = defsForSession(readOnlySession);
  const typeList = describeTypes(defs);
  return {
    name: "SubAgent",
    description:
      `Run a dedicated sub-agent in its own nested loop — the only result you receive is its final report as text, not intermediate steps. ${typeList}. These are the only valid type values — never pass any other string. Sub-agents cannot ask questions, use skills or todos, or spawn further sub-agents.`,
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: defs.map((d) => d.type),
          description: `The sub-agent type to invoke: ${typeList}.`,
        },
        label: {
          type: "string",
          maxLength: MAX_LABEL_LENGTH,
          description: `Short label (max ${MAX_LABEL_LENGTH} characters) for this sub-agent run, shown in the UI.`,
        },
        task: { type: "string", description: "The task or question for the sub-agent, as a self-contained description." },
      },
      required: ["type", "task"],
    },
    summarizeArgs: (args) => {
      const type = args.type as string;
      const label = typeof args.label === "string" ? summarizeText(args.label, MAX_LABEL_LENGTH) : "";
      const def = defs.find((d) => d.type === type);
      return (def?.name || type) + (label ? ` ${label}`: "");
    },
    async execute(args, ctx) {
      const type = args.type as string;
      const task = ((args.task as string) ?? "").trim();
      const def = defs.find((d) => d.type === type);
      if (!def) {
        return toolError(`unknown sub-agent type "${type}". Valid types: ${defs.map((d) => d.type).join(", ")}`);
      }
      if (!task) {
        return toolError("task is required");
      }

      const { status, reply, messages } = await deps.runSubAgent(def.systemPrompt, task, def.level, ctx.signal);

      if (status === "ok") return { content: reply };
      let stallReason: string | undefined;
      if (status === "stalled") {
        for (let i = messages.length - 1; i >= 0; i--) {
          const content = messages[i].content;
          if (typeof content === "string" && content.startsWith(NOT_EXECUTED_PREFIX)) {
            stallReason = content;
            break;
          }
        }
      }
      const suffix = stallReason ? ` ${stallReason}` : "";
      return { content: `Sub-agent "${def.name}" ended with status ${status}.${suffix}\n\n${reply}`, isError: true };
    },
  };
}
