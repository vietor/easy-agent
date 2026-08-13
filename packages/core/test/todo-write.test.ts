import { test } from "node:test";
import assert from "node:assert/strict";
import { createTodoWriteTool } from "../src/tools/todo-write.js";
import type { Todo } from "../src/tools/types.js";
import type { TextResult } from "../src/tools/types.js";

function makeTool() {
  let current: Todo[] | null = null;
  const tool = createTodoWriteTool((t) => { current = t; });
  return { tool, getTodos: () => current };
}

test("valid list replaces the store and reports counts", async () => {
  const { tool, getTodos } = makeTool();
  const result = await tool.execute(
    {
      todos: [
        { content: "a", status: "pending" },
        { content: "b", status: "completed" },
        { content: "c", status: "inProgress" },
      ],
    },
    { cwd: process.cwd() }
  );
  assert.match(result.content, /3 items, 1 done/);
  assert.equal(getTodos()?.length, 3);
  assert.equal(getTodos()?.[2].status, "inProgress");
});

test("non-array todos is an error and leaves the list untouched", async () => {
  const { tool, getTodos } = makeTool();
  await tool.execute({ todos: [{ content: "a", status: "pending" }] }, { cwd: process.cwd() });
  const result = await tool.execute({ todos: "oops" }, { cwd: process.cwd() }) as TextResult;
  assert.equal(result.isError, true);
  assert.match(result.content, /must be an array/);
  assert.equal(getTodos()?.length, 1);
});

test("missing todos is an error and leaves the list untouched", async () => {
  const { tool, getTodos } = makeTool();
  await tool.execute({ todos: [{ content: "a", status: "pending" }] }, { cwd: process.cwd() });
  const result = await tool.execute({}, { cwd: process.cwd() }) as TextResult;
  assert.equal(result.isError, true);
  assert.equal(getTodos()?.length, 1);
});

test("explicit empty list is a valid clear", async () => {
  const { tool, getTodos } = makeTool();
  await tool.execute({ todos: [{ content: "a", status: "pending" }] }, { cwd: process.cwd() });
  const result = await tool.execute({ todos: [] }, { cwd: process.cwd() });
  assert.equal(typeof result, "object");
  assert.equal(getTodos()?.length, 0);
});

test("normalizes to a single inProgress and downgrades unknown statuses", async () => {
  const { tool, getTodos } = makeTool();
  const result = await tool.execute(
    {
      todos: [
        { content: "a", status: "inProgress" },
        { content: "b", status: "inProgress" },
        { content: "c", status: "weird" },
      ],
    },
    { cwd: process.cwd() }
  );
  assert.match(result.content, /normalized 1 item/);
  const todos = getTodos()!;
  assert.equal(todos.filter((t) => t.status === "inProgress").length, 1);
  assert.equal(todos[0].status, "inProgress");
  assert.equal(todos[1].status, "pending");
  assert.equal(todos[2].status, "pending");
});
