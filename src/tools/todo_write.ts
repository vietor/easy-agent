import type { Tool, Todo, TodoStatus } from "./types.js";

const STATUSES: TodoStatus[] = ["pending", "in_progress", "completed"];

const DESCRIPTION = [
  "Manage the multi-step task list for the current work.",
  "Use for non-trivial tasks with 3 or more steps: write the full plan up front, mark one step in_progress when you start it, and completed when done.",
  "Pass the FULL list on every call; it replaces the previous list. Keep exactly one step in_progress at a time.",
  "Skip this for trivial one-step tasks. status is one of: pending, in_progress, completed.",
].join(" ");

export const todoWriteTool: Tool = {
  name: "TodoWrite",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The full task list, in execution order.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "A short imperative description of the step." },
            status: { type: "string", enum: STATUSES, description: "Current status of the step." },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  async execute(args, ctx) {
    const raw = Array.isArray(args.todos) ? (args.todos as Partial<Todo>[]) : [];
    const todos: Todo[] = [];
    for (const t of raw) {
      if (!t) continue;
      const content = typeof t.content === "string" ? t.content.trim() : "";
      if (!content) continue;
      const status: TodoStatus = STATUSES.includes(t.status as TodoStatus) ? (t.status as TodoStatus) : "pending";
      todos.push({ content, status });
    }
    ctx.setTodos(todos);
    const done = todos.filter((t) => t.status === "completed").length;
    return `Updated task list (${todos.length} item${todos.length === 1 ? "" : "s"}, ${done} done).`;
  },
};
