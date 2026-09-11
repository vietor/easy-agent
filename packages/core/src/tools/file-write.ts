import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Tool } from "./types.js";
import { parseToolArgs, toToolParameters } from "./types.js";

const DESCRIPTION = "Write content to a file, overwriting if it exists and creating parent directories. For targeted changes prefer Edit.";

const PATH_ERROR = "path is required";
const CONTENT_ERROR = "content is required";

const WriteArgs = z.object({
  path: z.string({ error: PATH_ERROR }).min(1, { error: PATH_ERROR }),
  content: z.string({ error: CONTENT_ERROR }),
});

export const fileWriteTool: Tool = {
  name: "Write",
  agentLevel: 2,
  description: DESCRIPTION,
  parameters: toToolParameters(WriteArgs),
  async execute(args, ctx) {
    const { path, content } = parseToolArgs(WriteArgs, args);
    const resolved = resolve(ctx.cwd, path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    return { content: `Wrote ${path}` };
  },
  summarizeResult(result) {
    if (result.isError) return "Write failed";
    return "Write completed";
  },
  argSummaryKeys: ["path"],
};
