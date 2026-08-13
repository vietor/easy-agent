export interface TextResult {
  content: string;
  isError?: boolean;
}

export function toolError(msg: string): TextResult {
  const content = msg.startsWith("Error: ") ? msg : `Error: ${msg}`;
  return { content: content, isError: true };
}

export type TodoStatus = "pending" | "inProgress" | "completed";

export interface Todo {
  content: string;
  status: TodoStatus;
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
  summaryKeys?: string[];
  summarizeArgs?: (args: Record<string, unknown>) => string;
  summarizeResult?(result: TextResult): string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<TextResult>;
}
