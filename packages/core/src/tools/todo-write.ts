import { z } from "zod";
import type { Tool, Todo, TodoStatus } from "./types.js";
import { toToolParameters, toolError, tryParseToolArgs } from "./types.js";

export const TODO_WRITE_GUIDANCE = "- For multi-step tasks (5+ steps), you MUST use TodoWrite: create the task list first, then update statuses as tasks complete. Never execute a 5+ step task without a TodoWrite task list. If a step turns out to be unnecessary or cannot be done, rewrite or remove it from the list — never leave stale items pending.";

const STATUSES: TodoStatus[] = ["pending", "inProgress", "completed"];

const STATUS_BY_KEY: Record<string, TodoStatus> = Object.fromEntries(STATUSES.map((s) => [s.toLowerCase(), s]));

const DESCRIPTION = "Manage the task list for tasks with 5+ steps. Pass the FULL list each call; it replaces the previous list. Keep one inProgress at a time. status: pending, inProgress, completed.";

const TODO_ARRAY_ERROR = '"todos" must be an array of {content, status} objects';
const TODO_ITEM_ERROR = "each todo must be a {content, status} object";
const TODO_CONTENT_ERROR = 'each todo needs a non-empty "content"';
const TODO_STATUS_ERROR = `each todo needs a "status" of ${STATUSES.join(", ")}`;

const TodoItemSchema = z.object({
  content: z.string({ error: TODO_CONTENT_ERROR }).trim().min(1, { error: TODO_CONTENT_ERROR })
    .describe("A short imperative description of the step."),
  status: z.enum(STATUSES, { error: TODO_STATUS_ERROR }).describe("Current status of the step."),
}, { error: TODO_ITEM_ERROR });

const TodoWriteArgs = z.object({
  todos: z.array(TodoItemSchema, { error: TODO_ARRAY_ERROR }).describe("The full task list, in execution order."),
});

function normalizeStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return STATUS_BY_KEY[value.trim().toLowerCase().replace(/[^a-z]/g, "")] ?? value;
}

function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const todos = args.todos;
  if (!Array.isArray(todos)) return args;
  return {
    ...args,
    todos: todos.map((t) =>
      typeof t === "object" && t !== null ? { ...t, status: normalizeStatus((t as Record<string, unknown>).status) } : t
    ),
  };
}

function parseTodos(args: Record<string, unknown>): { todos: Todo[]; done: number; normalized: number; error?: string } {
  const parsed = tryParseToolArgs(TodoWriteArgs, normalizeArgs(args));
  if (!parsed.ok) {
    return { todos: [], done: 0, normalized: 0, error: parsed.error };
  }
  const todos: Todo[] = [];
  let done = 0;
  let normalized = 0;
  let seenInProgress = false;
  for (const t of parsed.value.todos) {
    let status: TodoStatus = t.status;
    if (status === "inProgress") {
      if (seenInProgress) {
        status = "pending";
        normalized++;
      } else {
        seenInProgress = true;
      }
    } else if (status === "completed") {
      done++;
    }
    todos.push({ content: t.content, status });
  }
  if (!seenInProgress) {
    const firstPending = todos.find((t) => t.status === "pending");
    if (firstPending) {
      firstPending.status = "inProgress";
      normalized++;
    }
  }
  return { todos, done, normalized };
}

export function createTodoWriteTool(setTodos: (todos: Todo[]) => void): Tool {
  return {
    name: "TodoWrite",
    description: DESCRIPTION,
    parameters: toToolParameters(TodoWriteArgs),
    summarizeArgs(args) {
      const { todos, done, error } = parseTodos(args);
      return error ? "invalid" : `${done}/${todos.length}`;
    },
    async execute(args, _ctx) {
      const { todos, done, normalized, error } = parseTodos(args);
      if (error) return toolError(error);
      setTodos(todos);
      const note = normalized ? ` (normalized ${normalized} item${normalized === 1 ? "" : "s"} to one inProgress)` : "";
      return { content: `Updated task list (${todos.length} item${todos.length === 1 ? "" : "s"}, ${done} done)${note}.` };
    },
  };
}
