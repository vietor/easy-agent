import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Tool } from "./types.js";
import { resolveRequiredPath } from "../util/file.js";

const DESCRIPTION = "Write content to a file, overwriting if it exists and creating parent directories. For targeted changes prefer Edit.";

export const fileWriteTool: Tool = {
  name: "Write",
  description: DESCRIPTION,
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(args, ctx) {
    const resolved = resolveRequiredPath(args, ctx.cwd);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, args.content as string, "utf-8");
    return { content: `Wrote ${args.path}` };
  },
  summarizeResult(result) {
    if (result.isError) return "Write failed";
    return "Write completed";
  },
  argSummaryKeys: ["path"],
};
