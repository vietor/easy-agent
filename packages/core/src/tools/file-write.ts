import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";
import { parseToolArgs, toToolParameters } from "./types.js";

const DESCRIPTION = "Write content to a file, overwriting if it exists and creating parent directories. Set append to add to the end of the file instead of overwriting it. For targeted changes prefer Edit.";

const PATH_ERROR = "path is required";
const CONTENT_ERROR = "content is required";
const APPEND_ERROR = "append must be a boolean";

const WriteArgs = z.object({
  path: z.string({ error: PATH_ERROR }).min(1, { error: PATH_ERROR }),
  content: z.string({ error: CONTENT_ERROR }),
  append: z.boolean({ error: APPEND_ERROR }).optional().describe("append to the file instead of overwriting it (default false)"),
});

export const fileWriteTool: Tool = {
  name: "Write",
  agentLevel: 2,
  description: DESCRIPTION,
  parameters: toToolParameters(WriteArgs),
  async execute(args, ctx) {
    const { path, content, append } = parseToolArgs(WriteArgs, args);
    const resolved = resolve(ctx.cwd, path);
    await mkdir(dirname(resolved), { recursive: true });
    if (append === true) {
      await appendFile(resolved, content, "utf-8");
      return { content: `Appended to ${path}` };
    }
    await writeFile(resolved, content, "utf-8");
    return { content: `Wrote ${path}` };
  },
  summarizeResult(result) {
    if (result.isError) return "Write failed";
    return "Write completed";
  },
  argSummaryKeys: ["path"],
};
