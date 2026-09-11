import { test } from "node:test";
import assert from "node:assert/strict";
import { createAskUserTool } from "../src/tools/ask-user.js";
import { createSkillTool } from "../src/tools/skill.js";
import { createSubAgentTool } from "../src/tools/sub-agent.js";
import { createTodoWriteTool } from "../src/tools/todo-write.js";
import { fileEditTool } from "../src/tools/file-edit.js";
import { fileReadTool } from "../src/tools/file-read.js";
import { fileWriteTool } from "../src/tools/file-write.js";
import { globTool } from "../src/tools/glob.js";
import { grepTool } from "../src/tools/grep.js";
import { shellTool } from "../src/tools/shell.js";
import { webFetchTool } from "../src/tools/web-fetch.js";
import type { Tool } from "../src/tools/types.js";

const allTools: Tool[] = [
  fileReadTool,
  globTool,
  grepTool,
  webFetchTool,
  shellTool,
  fileWriteTool,
  fileEditTool,
  createAskUserTool(async () => []),
  createSkillTool(() => undefined),
  createTodoWriteTool(() => {}),
  createSubAgentTool({ runSubAgent: async () => ({ status: "ok", reply: "", messages: [] }) }),
];

function schemaKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) schemaKeys(item, keys);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      schemaKeys(nested, keys);
    }
  }
  return keys;
}

test("every built-in tool schema is free of $schema and additionalProperties", () => {
  for (const tool of allTools) {
    const keys = schemaKeys(tool.parameters);
    assert.equal(keys.has("$schema"), false, `${tool.name} must not emit $schema`);
    assert.equal(keys.has("additionalProperties"), false, `${tool.name} must not emit additionalProperties`);
  }
});

test("Edit requires new_string and rejects a non-boolean replace_all", async () => {
  await assert.rejects(
    () => fileEditTool.execute({ path: "x", old_string: "a" }, { cwd: process.cwd() }),
    /new_string is required/
  );
  await assert.rejects(
    () => fileEditTool.execute({ path: "x", old_string: "a", new_string: "b", replace_all: "true" }, { cwd: process.cwd() }),
    /replace_all must be a boolean/
  );
});

test("Write requires string content", async () => {
  await assert.rejects(() => fileWriteTool.execute({ path: "x" }, { cwd: process.cwd() }), /content is required/);
  await assert.rejects(() => fileWriteTool.execute({ path: "x", content: 5 }, { cwd: process.cwd() }), /content is required/);
});

test("Shell requires a non-empty command", async () => {
  await assert.rejects(() => shellTool.execute({}, { cwd: process.cwd() }), /command is required/);
  await assert.rejects(() => shellTool.execute({ command: "" }, { cwd: process.cwd() }), /command is required/);
});
