import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Tool } from "../types.js";

export const write: Tool = {
  name: "write",
  description: "Write content to a file, creating parent directories as needed.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async execute(args) {
    const path = args.path as string;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, args.content as string, "utf-8");
    return `Wrote ${path}`;
  },
};
