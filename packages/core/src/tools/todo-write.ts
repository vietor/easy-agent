import type { Tool, Todo, TodoStatus } from "./types.js";
import { toolError } from "../util/types.js";

export const TODO_WRITE_GUIDANCE = "- For multi-step tasks (3+ steps), you MUST use TodoWrite: create the task list first, then update each task's status as you execute. Never execute a multi-step task without a TodoWrite task list.";

const STATUSES: TodoStatus[] = ["pending", "in_progress", "completed"];

const DESCRIPTION = "Manage the task list for tasks with 3+ steps. Pass the FULL list each call; it replaces the previous list. Keep one in_progress at a time. status: pending, in_progress, completed.";

function parseTodos(args: Record<string, unknown>): { todos: Todo[]; done: number; normalized: number; error?: string } {
  const raw = args.todos;
  if (!Array.isArray(raw)) {
    return { todos: [], done: 0, normalized: 0, error: `"todos" must be an array of {content, status} objects, got ${typeof raw}` };
  }
  const todos: Todo[] = [];
  let done = 0;
  let normalized = 0;
  let seenInProgress = false;
  for (const t of raw as Partial<Todo>[]) {
    if (!t) continue;
    const content = typeof t.content === "string" ? t.content.trim() : "";
    if (!content) continue;
    let status: TodoStatus = STATUSES.includes(t.status as TodoStatus) ? (t.status as TodoStatus) : "pending";
    if (status === "in_progress") {
      if (seenInProgress) {
        status = "pending";
        normalized++;
      } else {
        seenInProgress = true;
      }
    } else if (status === "completed") {
      done++;
    }
    todos.push({ content, status });
  }
  return { todos, done, normalized };
}

export function createTodoWriteTool(setTodos: (todos: Todo[]) => void): Tool {
  return {
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
    summarizeArgs(args) {
      const { todos, done, error } = parseTodos(args);
      return error ? "invalid" : `${done}/${todos.length}`;
    },
    async execute(args, _ctx) {
      const { todos, done, normalized, error } = parseTodos(args);
      if (error) return toolError(error);
      setTodos(todos);
      const note = normalized ? ` (normalized ${normalized} item${normalized === 1 ? "" : "s"} to one in_progress)` : "";
      return `Updated task list (${todos.length} item${todos.length === 1 ? "" : "s"}, ${done} done)${note}.`;
    },
  };
}
