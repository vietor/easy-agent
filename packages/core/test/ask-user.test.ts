import { test } from "node:test";
import assert from "node:assert/strict";
import { createAskUserTool, type AskQuestion } from "../src/tools/ask-user.js";
import type { TextResult } from "../src/tools/types.js";

function makeTool() {
  let received: AskQuestion[] | null = null;
  const tool = createAskUserTool(async (questions) => {
    received = questions;
    return questions.map((q) => (q.multiSelect ? ["x", "y"] : "a"));
  });
  return { tool, getReceived: () => received };
}

test("formats answers as JSON keyed by question text", async () => {
  const { tool, getReceived } = makeTool();
  const result = await tool.execute(
    {
      questions: [
        { question: "env?", options: [{ label: "prod" }, { label: "dev" }], multiSelect: false },
        { question: "method?", options: [{ label: "email" }, { label: "slack" }], multiSelect: true },
      ],
    },
    { cwd: process.cwd() }
  );
  assert.deepEqual(JSON.parse(result.content), { "env?": "a", "method?": ["x", "y"] });
  assert.equal(getReceived()?.length, 2);
});

test("skipped questions map to empty strings", async () => {
  const tool = createAskUserTool(async () => ["", []]);
  const result = await tool.execute(
    {
      questions: [
        { question: "q1", options: [{ label: "a" }, { label: "b" }], multiSelect: false },
        { question: "q2", options: [{ label: "a" }, { label: "b" }], multiSelect: true },
      ],
    },
    { cwd: process.cwd() }
  );
  assert.deepEqual(JSON.parse(result.content), { q1: "", q2: [] });
});

test("invalid inputs error without calling ask", async () => {
  let called = false;
  const tool = createAskUserTool(async () => {
    called = true;
    return [];
  });
  const cases: unknown[] = [
    {},
    { questions: [] },
    { questions: Array.from({ length: 5 }, (_, i) => ({ question: `q${i}`, options: [{ label: "a" }, { label: "b" }] })) },
    { questions: [{ question: "q", options: [{ label: "a" }] }] },
    { questions: [{ question: "dup", options: [{ label: "a" }, { label: "b" }] }, { question: "dup", options: [{ label: "a" }, { label: "b" }] }] },
    { questions: [{ question: "", options: [{ label: "a" }, { label: "b" }] }] },
  ];
  for (const args of cases) {
    const result = await tool.execute(args as Record<string, unknown>, { cwd: process.cwd() }) as TextResult;
    assert.equal(result.isError, true);
  }
  assert.equal(called, false);
});

test("defaults and normalization", async () => {
  const { tool, getReceived } = makeTool();
  await tool.execute(
    {
      questions: [
        { question: "q", options: [{ label: "a", description: "desc" }, { label: "b" }], multiSelect: true },
        { question: "r", options: [{ label: "x" }, { label: "y" }] },
      ],
    },
    { cwd: process.cwd() }
  );
  assert.deepEqual(getReceived(), [
    { header: undefined, question: "q", options: [{ label: "a", description: "desc" }, { label: "b", description: undefined }], multiSelect: true },
    { header: undefined, question: "r", options: [{ label: "x", description: undefined }, { label: "y", description: undefined }], multiSelect: false },
  ]);
});

test("summarizeArgs reports question count", () => {
  const { tool } = makeTool();
  assert.equal(
    tool.summarizeArgs!({
      questions: [{ question: "which env?", options: [{ label: "a" }, { label: "b" }] }, { question: "how?", options: [{ label: "x" }, { label: "y" }] }],
    }),
    "2 questions"
  );
  assert.equal(tool.summarizeArgs!({}), "invalid");
});
