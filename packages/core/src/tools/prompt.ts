export const TOOL_USE_PROMPT = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- Prefer emitting independent tool calls together in one turn so they run concurrently (2-8 calls per turn is normal); do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- Scale planning: when a task involves many independent items (queries, reads, searches), estimate the count up front and pick a strategy: a few — do them directly; more — spread over a few turns with several calls per turn; many — delegate chunks via SubAgent (each chunk runs its own loop and budget, not yours).",
  "- A run has a limited budget of tool-calling turns. If a task needs far more turns than the budget, do not work item-by-item in the main loop — delegate chunks or narrow the scope.",
  "- For file operations (read/write/edit/glob/grep) and fetching URLs, use the dedicated tool. Fall back to Shell only when no dedicated tool covers the task and Shell is available. A runtime error does not make Shell the fallback; do not retry that same operation through Shell.",
  "- If a tool call fails, read the error, adjust the arguments or approach, and continue; do not repeat the identical call and do not abandon the task over a single failure.",
].join("\n");
