import type { ContentResult } from "../util/types.js";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface Todo {
  content: string;
  status: TodoStatus;
}

export function toolError(msg: string): ContentResult {
  const content = msg.startsWith("Error: ") ? msg : `Error: ${msg}`;
  return { content: content, isError: true };
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Tool {
  name: string;
  readOnly?: boolean;
  description: string;
  parameters: Record<string, unknown>;
  summaryArg?: string | string[];
  summarizeArgs?: (args: Record<string, unknown>) => string;
  getPreview?(result: ContentResult): string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ContentResult>;
}
