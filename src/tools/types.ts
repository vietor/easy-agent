export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  summaryArg?: string | string[];
  execute(args: Record<string, unknown>): Promise<string | ToolResult>;
}
