import type { Todo, TodoStatus } from "../tools/types.js";

export const TOOL_USE_PROMPT = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- Prefer emitting independent tool calls together in one turn so they run concurrently (2-8 calls per turn is normal); do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- Scale planning: when a task involves many independent items (queries, reads, searches), estimate the count up front and pick a strategy: a few — do them directly; more — spread over a few turns with several calls per turn.",
  "- A run has a limited budget of tool-calling turns. If a task needs far more turns than the budget, do not work item-by-item in the main loop — narrow the scope.",
  "- For file operations (read/write/edit/glob/grep) and fetching URLs, use the dedicated tool. Fall back to Shell only when no dedicated tool covers the task and Shell is available. A runtime error does not make Shell the fallback; do not retry that same operation through Shell.",
  "- If a tool call fails, read the error, adjust the arguments or approach, and continue; do not repeat the identical call and do not abandon the task over a single failure.",
].join("\n");

export const COMPACT_PROMPT = [
  "Summarize the conversation above for context continuation. Preserve:\n",
  "1. Primary goal, sub-goals, constraints, acceptance criteria.\n",
  "2. Decisions and rationale (including rejected approaches).\n",
  "3. Files (paths, signatures, config values, key code snippets).\n",
  "4. Tool calls and relevant results (commands, search hits, test output).\n",
  "5. Errors/failures and how they were resolved.\n",
  "6. Current progress: what is done, verified, and in-progress state.\n",
  "7. Pending tasks, open questions, concrete next step.\n",
  "Discard: completed small talk, verbose tool outputs already absorbed, resolved dead ends. Keep only what the next turn needs to continue without re-reading history.\n",
  "Concise but thorough; keep technical specifics; use the conversation language. Target roughly 10% of the original length, capped at a few hundred tokens — technical specifics over prose. ",
  "Start with \"Summary of conversation so far\":",
].join("");

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
    ? ` ${incomplete.length} incomplete. You MUST complete EVERY task before your final text-only response — update status via TodoWrite after each task finishes.`
    : "";
  return `<system-reminder>Tasks: ${items.join(" | ")}${focusLine}${warning}</system-reminder>`;
}

export function renderIncompleteTodoNudge(todos: readonly Todo[]): string {
  const incomplete = todos.filter(t => t.status !== "completed");
  const names = incomplete.map(t => `"${t.content}"`).join(", ");
  return `<system-reminder>STOP! You have ${incomplete.length} incomplete task(s): ${names}. Use tools to complete them. Call TodoWrite to mark each one completed before your final text response.</system-reminder>`;
}
