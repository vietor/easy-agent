import { test } from "node:test";
import assert from "node:assert/strict";
import { renderListing } from "../src/util/ripgrep.js";

test("a file listing drained in full reports an exact total", () => {
  const out = renderListing({ lines: ["a.txt"], truncated: true, all: ["a.txt", "b.txt"], capped: false }, "file", undefined, 0);
  assert.equal(out, "a.txt\n(output truncated) 2 files in total, showing the first 1");
});

test("a buffer-capped file listing reports a lower bound", () => {
  const out = renderListing({ lines: ["a.txt"], truncated: true, all: ["a.txt", "b.txt"], capped: true }, "file", undefined, 0);
  assert.equal(out, "a.txt\n(output truncated) at least 2 files, showing the first 1");
});

test("a capped content listing reports a lower bound", () => {
  const out = renderListing({ lines: ["a.txt:1:x"], truncated: true, all: ["a.txt:1:x", "b.txt:1:x"], capped: false }, "match", undefined, 0);
  assert.equal(out, "a.txt:1:x\n(output truncated) at least 2 matches, showing the first 1");
});
