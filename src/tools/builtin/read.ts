import { readFileSync } from "node:fs";
import type { Tool } from "../types.js";

export const read: Tool = {
  name: "read",
  description: "Read a file's text contents.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(args) {
    return readFileSync(args.path as string, "utf-8");
  },
};
