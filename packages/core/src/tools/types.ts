export interface ToolResult {
  content: string;
  isError?: boolean;
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface Todo {
  content: string;
  status: TodoStatus;
}

export interface ToolContext {
  signal?: AbortSignal;
  ask(question: string, options: string[]): Promise<string>;
  setTodos(todos: Todo[]): void;
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
  summarizeArgs?: (args: Record<string, unknown>) => string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolResult>;
}
