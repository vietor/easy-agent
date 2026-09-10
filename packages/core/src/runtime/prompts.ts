import type { Todo, TodoStatus } from "../tools/types.js";

const TOOL_USE_HEADER = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- Prefer emitting independent tool calls together in one turn so they run concurrently (2-8 calls per turn is normal); do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- Scale planning: when a task involves many independent items (queries, reads, searches), estimate the count up front and pick a strategy: a few — do them directly; more — spread over a few turns with several calls per turn.",
  "- A run has a limited budget of tool-calling turns. If a task needs far more turns than the budget, do not work item-by-item in the main loop: delegate chunks to sub-agents where that is possible, otherwise finish the highest-value items and report what remains — never silently narrow the scope.",
];

const FILE_TOOLS_LINE = "- For file operations (Read/Write/Edit/Glob/Grep) and fetching URLs, use the dedicated tool. Fall back to Shell only when no dedicated tool covers the task and Shell is available. A runtime error does not make Shell the fallback; do not retry that same operation through Shell.";
const READ_ONLY_TOOLS_LINE = "- For reading files (Read/Glob/Grep) and fetching URLs, use the dedicated tool. This session is read-only: no available tool can modify files or run Shell.";
const TOOL_FAILURE_LINE = "- If a tool call fails, read the error, adjust the arguments or approach, and continue; do not repeat the identical call and do not abandon the task over a single failure.";

export function renderToolUsePrompt(maxTurns: number, mode: "full" | "readOnly" | "none" = "full"): string {
  const lines = [...TOOL_USE_HEADER];
  if (mode === "full") lines.push(FILE_TOOLS_LINE);
  else if (mode === "readOnly") lines.push(READ_ONLY_TOOLS_LINE);
  lines.push(TOOL_FAILURE_LINE, `- Turn budget: ${maxTurns} tool-calling turns per run.`);
  return lines.join("\n");
}

export const COMPACT_PROMPT = [
  "Summarize the conversation above for context continuation. Preserve:",
  "1. Primary goal, sub-goals, constraints, acceptance criteria.",
  "2. Decisions and rationale (including rejected approaches).",
  "3. Files (paths, signatures, config values, key code snippets).",
  "4. Tool calls and relevant results (commands, search hits, test output).",
  "5. Errors/failures and how they were resolved.",
  "6. Current progress: what is done, verified, and in-progress state.",
  "7. Pending tasks, open questions, concrete next step.",
  "Discard: completed small talk, verbose tool outputs already absorbed, resolved dead ends. The full conversation will be replaced by this summary, so anything omitted is lost — keep only what the next turn needs to continue without re-reading history.",
  "Concise but thorough; keep technical specifics; use the conversation language. Aim for 500-1000 tokens, and never more than 1% of the conversation. Never a generic recap — technical specifics over prose.",
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
    ? ` ${incomplete.length} incomplete. You MUST complete EVERY task before your final text-only response. Mark them complete via TodoWrite as they finish; the final update may go in the same turn as your last tool call.`
    : "";
  return `<system-reminder>Tasks: ${items.join(" | ")}${focusLine}${warning}</system-reminder>`;
}

export function renderIncompleteTodoNudge(todos: readonly Todo[]): string {
  const incomplete = todos.filter(t => t.status !== "completed");
  const names = incomplete.map(t => `"${t.content}"`).join(", ");
  return `<system-reminder>STOP! You have ${incomplete.length} incomplete task(s): ${names}. Use tools to complete them. Call TodoWrite to mark each one completed before your final text response.</system-reminder>`;
}

export function renderCompactTodos(todos: readonly Todo[]): string {
  return `Current task list: ${todos.map(t => `[${t.status}] ${t.content}`).join(" | ")}`;
}
