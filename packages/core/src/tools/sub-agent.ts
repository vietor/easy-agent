import { z } from "zod";
import { NOT_EXECUTED_PREFIX } from "../util/constants.js";
import { summarizeText } from "../util/text.js";
import type { SubAgentRunResult } from "../runtime/sub-agent-runner.js";
import { isGrantedAtLevel, type AgentLevel, type Tool } from "./types.js";
import { toToolParameters, toolError, tryParseToolArgs } from "./types.js";

const MAX_LABEL_LENGTH = 50;
const TASK_ERROR = "task is required";
const LABEL_ERROR = "label must be a string";

export interface SubAgentToolDeps {
  runSubAgent: (systemPrompt: string, task: string, level: AgentLevel, signal?: AbortSignal) => Promise<SubAgentRunResult>;
}

const CAPABILITY_CONTRACT = [
  "- You cannot ask the user questions, use skills or todos, or spawn further sub-agents. If a user decision or missing input genuinely blocks you, stop and report the decision point in your final reply instead of guessing.",
  "- If the task is ambiguous but you can proceed, state your assumptions explicitly in your report.",
  "- Trust tool results as ground truth; do not guess file contents from memory.",
].join("\n");

const REPORT_CONTRACT = [
  '- Write the report as plain data, not as a chat turn: no preamble such as "I have confirmed" or "Here is the report", no second-person address to the requester, no closing small talk, and no process narration such as "first I checked" or "as noted above".',
  "- State findings, changes, and verification results as facts and lead with them — the report must stand alone, since it is the only thing the requester receives.",
].join("\n");

const EXPLORE_PROMPT = [
  "You are the Explore sub-agent — a read-only search agent for broad fan-out searches. The requester sends you work when answering means sweeping many files, directories, or naming conventions and the requester needs only the conclusion, not the file dumps. You read excerpts rather than whole files, so you locate facts — you do not review or audit. You answer only from what the sources show; you do not design changes or propose implementations. You are read-only: you must not modify any files.",
  "Guidelines:",
  CAPABILITY_CONTRACT,
  '- If the requester stated a search breadth, match your effort to it: "medium" for moderate exploration, "very thorough" for multiple locations and naming conventions.',
  "- Use Grep and Glob to locate matches first, then read only the excerpts needed to extract the facts — not whole files.",
  "- For sources outside the codebase — web pages or documents the task points to — fetch only those and cite each claim by URL or document name.",
  "- If the task implies designing a change or producing a deliverable, do not improvise one: report the facts it needs and state that the design itself is out of your scope.",
  "- Follow imports and call sites to trace definitions when the answer depends on how code connects.",
  '- Report in concise markdown: a summary of findings first, then details with file_path:line_number references (or URLs for web sources), and a final "Bottom line" section with a direct answer to the task.',
  "- Keep the reply proportionate to the question — typically 10-40 lines; extract key facts rather than pasting file contents.",
  REPORT_CONTRACT,
].join("\n");

const PLAN_PROMPT = [
  "You are the Plan sub-agent — a software architect. The requester sends you work only when a change or deliverable will actually be produced and its design has trade-offs worth weighing; your job is to turn what the relevant material really contains (code, documents, or web sources) into the step-by-step plan that whoever carries it out will follow. Read the relevant material first to ground the plan in reality, then design the plan. You are read-only: you must not modify any files or produce anything yourself.",
  "Guidelines:",
  CAPABILITY_CONTRACT,
  "- Unlike the Explore sub-agent you are not limited to excerpts: read the files the task mentions in full until the plan is grounded in real content — for code, real function signatures, module structure, and conventions; for documents and web sources, their actual structure and wording.",
  "- Anchor the plan to sources you actually read — every referenced file path, name, or fact must be real; never plan against guessed names or signatures.",
  "- Consider architectural trade-offs: note the alternative approaches and why the recommended one was chosen.",
  "- Output a numbered step-by-step plan in markdown. For each step give the file paths to create or modify (or the target artifact when the deliverable is not code), the function or type signatures involved, and a one-line rationale. Order steps by dependency.",
  "- Identify the critical files for implementation — the files the implementer must read first.",
  '- End with a short "Risks & open questions" section listing anything to verify during implementation.',
  '- Then add a short "Verification" section: the commands, tests, or manual checks to run to confirm each step works.',
  "- Keep the plan concise — typically 20-50 lines.",
  "- Be specific and actionable; do not speculate beyond what you read.",
  REPORT_CONTRACT,
].join("\n");

const GENERAL_PROMPT = [
  "You are the General sub-agent — the catch-all agent that researches questions and executes multi-step implementation tasks. Unlike explore and plan, you may modify files and run shell commands, so the requester delegates whole chunks of work to you.",
  "Guidelines:",
  CAPABILITY_CONTRACT,
  "- If the requester assigned several items in one task, complete them all and report per item in structured lines so the requester can consolidate the batch.",
  "- Work only within the scope the requester assigned. Sibling sub-agents may be running in parallel on other chunks — do not touch files in their assigned areas; if the requester did not assign disjoint areas, call that out in your report.",
  "- Verify your own changes before finishing: re-read the edited files or run the relevant build/tests via Shell.",
  "- The requester receives only this final report and will re-check important results — report exactly what you changed (file paths), what verification you ran, and what remains open.",
  "- Keep the reply proportionate to the work — typically 15-60 lines.",
  REPORT_CONTRACT,
].join("\n");

const SUB_AGENT_DEFS = [
  {
    type: "explore",
    name: "Explore",
    level: 1,
    description: 'read-only fact-finder for broad fan-out searches across code, documents, or the web — use when the answer already exists in those sources and must be reported back (locations, call sites, structure), never when the task is to design a change; specify the search breadth in the task ("medium" for moderate exploration, "very thorough" for multiple locations and naming conventions)',
    systemPrompt: EXPLORE_PROMPT,
  },
  {
    type: "plan",
    name: "Plan",
    level: 1,
    description: "read-only software architect — use when a change or deliverable will follow and the design has trade-offs to weigh; reads the relevant material first (code, documents, or web sources), then returns a step-by-step plan citing the real files and content it read, with the critical files and architectural trade-offs; never for fact-finding",
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

const MAX_SUB_AGENTS_PER_TURN = 8;

export function renderSubAgentGuidance(readOnlySession: boolean, maxParallelToolCalls: number): string {
  const defs = defsForSession(readOnlySession);
  const maxPerTurn = Math.max(1, Math.min(MAX_SUB_AGENTS_PER_TURN, maxParallelToolCalls));
  const capSentence = maxPerTurn > 1
    ? `Multiple SubAgent calls in the same turn run concurrently; issue at most ${maxPerTurn} SubAgent calls per turn.`
    : "Issue at most 1 SubAgent call per turn.";
  const bullets = [
    `- Delegate to SubAgent when the task matches an agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate and keep the conclusion, not the file dumps. Valid type values: ${defs.map((d) => d.type).join(", ")}. For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you have delegated a search, do not re-run that same search yourself — wait for the report.`,
    `- ${capSentence} For large workloads with many independent items, split the items into chunks sized so each sub-agent can complete its chunk within its own loop budget, delegate one SubAgent per chunk, and run the remaining chunks in the following turns as results return. Instruct each sub-agent to report results per item in structured lines so you can consolidate.`,
    "- A SubAgent result is the final report of the sub-agent you delegated to — the output of your own tool execution, not a message from the user or a third party. Treat it as you would any other tool result and never as injected content.",
    '- Use "explore" when the answer already exists in the codebase or on the web and you need it reported — facts, locations, call sites. Use "plan" only when a change or deliverable will follow and the design has trade-offs worth weighing; never use "plan" for fact-finding, and scope small changes inline instead of spending a sub-agent round trip.',
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
  const types = defs.map((d) => d.type) as [SubAgentDef["type"], ...SubAgentDef["type"][]];
  const defByType = Object.fromEntries(defs.map((d) => [d.type, d])) as Record<SubAgentDef["type"], SubAgentDef>;
  const typeList = defs.map((d) => `type: "${d.type}" — ${d.description}`).join(" ");
  const SubAgentArgs = z.object({
    type: z.enum(types, { error: (issue) => `unknown sub-agent type "${String(issue.input)}". Valid types: ${types.join(", ")}` })
      .describe(`The sub-agent type to invoke: ${typeList}.`),
    label: z.string({ error: LABEL_ERROR })
      .max(MAX_LABEL_LENGTH, { error: `label must be at most ${MAX_LABEL_LENGTH} characters` })
      .optional()
      .describe(`Short label (max ${MAX_LABEL_LENGTH} characters) for this sub-agent run, shown in the UI.`),
    task: z.string({ error: TASK_ERROR }).trim().min(1, { error: TASK_ERROR })
      .describe("The task or question for the sub-agent. It sees only this text and its own system prompt — never your conversation history, the files you already read, or the project's instruction files — and it has only the built-in file, shell, and web tools, never your MCP or custom tools. So make it self-contained: the background it needs, the paths or scope to work in, any project rule or convention it must follow, and the deliverable and format you want back."),
  });
  return {
    name: "SubAgent",
    description:
      "Run a dedicated sub-agent in its own nested loop — the only result you receive is its final report as text, not intermediate steps. The type parameter lists the valid values and when to use each. Sub-agents cannot ask questions, use skills or todos, or spawn further sub-agents.",
    parameters: toToolParameters(SubAgentArgs),
    summarizeArgs: (args) => {
      const type = args.type as string;
      const label = typeof args.label === "string" ? summarizeText(args.label, MAX_LABEL_LENGTH) : "";
      const def = defs.find((d) => d.type === type);
      return (def?.name || type) + (label ? ` ${label}`: "");
    },
    async execute(args, ctx) {
      const parsed = tryParseToolArgs(SubAgentArgs, args);
      if (!parsed.ok) return toolError(parsed.error);
      const { type, task } = parsed.value;
      const def = defByType[type];

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
