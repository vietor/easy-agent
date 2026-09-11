import { z } from "zod";

export interface TextResult {
  content: string;
  isError?: boolean;
}

export function toolError(msg: string): TextResult {
  const content = msg.startsWith("Error: ") ? msg : `Error: ${msg}`;
  return { content: content, isError: true };
}

export function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input", target: "openapi-3.0" }) as Record<string, unknown>;
}

function issueMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

export function parseToolArgs<S extends z.ZodType>(schema: S, args: Record<string, unknown>): z.output<S> {
  const result = schema.safeParse(args);
  if (result.success) return result.data;
  throw new Error(issueMessage(result.error));
}

export function tryParseToolArgs<S extends z.ZodType>(
  schema: S,
  args: Record<string, unknown>
): { ok: true; value: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(args);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: issueMessage(result.error) };
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

export type AgentLevel = 0 | 1 | 2;

export function isGrantedAtLevel(agentLevel: AgentLevel | undefined, maxLevel: AgentLevel): boolean {
  return agentLevel !== undefined && agentLevel >= 1 && agentLevel <= maxLevel;
}

export interface Tool {
  name: string;
  agentLevel?: AgentLevel;
  description: string;
  parameters: Record<string, unknown>;
  argSummaryKeys?: string[];
  summarizeArgs?: (args: Record<string, unknown>) => string;
  summarizeResult?(result: TextResult): string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<TextResult>;
}
