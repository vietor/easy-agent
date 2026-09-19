import { TURN_BUDGET_WARN_RATIO } from "../util/constants.js";
import type { Todo, TodoStatus } from "../tools/types.js";

const TOOL_USE_HEADER = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- Prefer emitting independent tool calls together in one turn so they run concurrently (2-8 calls per turn is normal); do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- Scale planning: when a task involves many independent items (queries, reads, searches), estimate the count up front and pick a strategy: a few — do them directly; more — spread over a few turns with several calls per turn; a whole repository — map its structure before reading anything, then work module by module instead of file by file.",
  "- A run has a limited budget of tool-calling turns. If a task needs far more turns than the budget, do not work item-by-item in the main loop: finish the highest-value items and report what remains — never silently narrow the scope.",
];

const FILE_TOOLS_LINE = "- For file operations (Read/Write/Edit/Glob/Grep) and fetching URLs, use the dedicated tool. Fall back to Shell only when no dedicated tool covers the task and Shell is available. A runtime error does not make Shell the fallback; do not retry that same operation through Shell.";
const READ_ONLY_TOOLS_LINE = "- For reading files (Read/Glob/Grep) and fetching URLs, use the dedicated tool. The built-in tools that modify files or run Shell are disabled in this session; do not reach for another tool to work around that.";
const TOOL_FAILURE_LINE = "- If a tool call fails, read the error, adjust the arguments or approach, and continue; do not repeat the identical call and do not abandon the task over a single failure.";

export function renderToolUsePrompt(maxTurns: number, mode: "full" | "readOnly" | "none" = "full", notesPath?: string): string {
  const lines = [...TOOL_USE_HEADER];
  if (mode === "full") lines.push(FILE_TOOLS_LINE);
  else if (mode === "readOnly") lines.push(READ_ONLY_TOOLS_LINE);
  if (mode === "full" && notesPath) lines.push(renderNotesLine(notesPath));
  lines.push(
    TOOL_FAILURE_LINE,
    `- Turn budget: ${maxTurns} tool-calling turns per run. You are warned in-band each turn once only a few are left, and the turn after the budget is spent is reserved for your final answer, with all tools disabled.`
  );
  return lines.join("\n");
}

function renderNotesLine(notesPath: string): string {
  return `- Long investigations: record each confirmed fact (file paths, signatures, decisions, open questions) as a line in \`${notesPath}\` in the same turn you learn it. Automatic compaction replaces the conversation with a summary, so after one, re-read that file instead of re-exploring.`;
}

export function renderTurnBudget(used: number, maxTurns: number): string | undefined {
  const remaining = maxTurns - used;
  if (remaining > Math.ceil(maxTurns * TURN_BUDGET_WARN_RATIO)) return undefined;
  if (remaining < 1) {
    return [
      `<system-reminder>Turn budget exhausted (${maxTurns} tool-calling turns used). Tools are disabled for this turn and any tool call will be rejected — do not attempt one, including TodoWrite.`,
      "Write your final answer now: what you completed and verified, what you could not verify, and what remains unfinished.</system-reminder>",
    ].join(" ");
  }
  return `<system-reminder>Turns used: ${used}/${maxTurns} (${remaining} left). Wrap up now: stop opening new lines of investigation, record what you found, and finish the deliverable.</system-reminder>`;
}

export const TOOL_OUTPUT_GUIDANCE =
  "- Oversized tool output is truncated and the full text is saved to a file; the truncation notice names the path. Search that file with Grep, or Read it with an explicit small limit — reading it in large chunks just truncates it again. Do not re-run the command through head/tail or another shell truncation to see more; the saved file already holds the complete output.";

export const COMPACT_PROMPT = [
  "Summarize the conversation above for context continuation. Preserve:",
  "1. Primary goal, sub-goals, constraints, acceptance criteria.",
  "2. Decisions and rationale (including rejected approaches).",
  "3. Files (paths, signatures, config values, key code snippets).",
  "4. Tool calls and relevant results (commands, search hits, test output).",
  "5. Errors/failures and how they were resolved.",
  "6. Current progress: what is done, verified, and in-progress state.",
  "7. Pending tasks, open questions, concrete next step.",
  "Discard: completed small talk, verbose tool outputs already absorbed, resolved dead ends. The most recent messages are kept verbatim; everything before them is replaced by this summary, so anything omitted there is lost — keep only what the next turn needs to continue without re-reading history.",
  "Concise but thorough; keep technical specifics; use the conversation language. Aim for 500-1000 tokens. Never a generic recap — technical specifics over prose.",
  'Start with "Summary of conversation so far":',
].join("\n");

const STATUS_GLYPHS: Record<TodoStatus, string> = {
  pending: "○",
  inProgress: "◐",
  completed: "✓",
};

export function renderTodoReminder(todos: readonly Todo[]): string {
  const items = todos.map((t) => {
    return `${STATUS_GLYPHS[t.status]} ${t.content}`;
  });
  const focus = todos.find((t) => t.status === "inProgress");
  const focusLine = focus ? ` Current focus: ${focus.content}` : "";
  const incomplete = todos.filter(t => t.status !== "completed");
  const warning = incomplete.length > 0
    ? ` ${incomplete.length} incomplete. You MUST complete EVERY task before your final text-only response. Mark them complete via TodoWrite as they finish — never mark one complete that you have not verified; the final update may go in the same turn as your last tool call.`
    : "";
  return `<system-reminder>Tasks: ${items.join(" | ")}${focusLine}${warning}</system-reminder>`;
}

export function renderIncompleteTodoNudge(todos: readonly Todo[]): string {
  const incomplete = todos.filter(t => t.status !== "completed");
  const names = incomplete.map(t => `"${t.content}"`).join(", ");
  return `<system-reminder>STOP! You have ${incomplete.length} incomplete task(s): ${names}. Use tools to finish them, or rewrite the list to what actually remains — never mark work completed that you have not verified.</system-reminder>`;
}

export function renderCompactTodos(todos: readonly Todo[]): string {
  return `Current task list: ${todos.map(t => `[${t.status}] ${t.content}`).join(" | ")}`;
}
