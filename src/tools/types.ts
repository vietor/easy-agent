export interface ToolResult {
  content: string;
  isError?: boolean;
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
  description: string;
  parameters: Record<string, unknown>;
  summaryArg?: string | string[];
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string | ToolResult>;
}
