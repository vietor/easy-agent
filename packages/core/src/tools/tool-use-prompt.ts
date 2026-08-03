export const TOOL_USE_PROMPT = [
  "Tool-Use Guidelines:",
  "The user's instructions in the preceding sections take precedence over these defaults.",
  "",
  "- When several tool calls have no dependencies on each other's results, emit them together in one turn so they run concurrently; do not batch calls that depend on a prior result or that modify the same file or resource.",
  "- For file operations (read/write/edit/glob/grep) and fetching URLs, use the dedicated tool. Fall back to Shell only when no dedicated tool covers the task and Shell is available. A runtime error does not make Shell the fallback; do not retry that same operation through Shell.",
].join("\n");
