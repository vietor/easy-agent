import { z } from "zod";

export interface ToolResult {
  content: string;
  isError?: boolean;
  structured?: unknown;
}

export function toolError(msg: string): ToolResult {
  const content = msg.startsWith("Error: ") ? msg : `Error: ${msg}`;
  return { content: content, isError: true };
}

export function toToolParameters(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: "input", target: "openapi-3.0" }) as Record<string, unknown>;
}

export function issueMessage(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

export function parseToolArgs<S extends z.ZodType>(schema: S, args: Record<string, unknown>): z.output<S> {
  const parsed = tryParseToolArgs(schema, args);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function tryParseToolArgs<S extends z.ZodType>(
  schema: S,
  args: Record<string, unknown>
): { ok: true; value: z.output<S> } | { ok: false; error: string } {
  const result = schema.safeParse(args);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: issueMessage(result.error) };
}

export function nonNegativeInt(name: string, description: string) {
  const error = `${name} must be a non-negative integer`;
  return z.number({ error }).min(0, { error }).refine(Number.isInteger, { error }).describe(description);
}

export function positiveInt(name: string, description: string) {
  const error = `${name} must be a positive integer`;
  return z.number({ error }).min(1, { error }).refine(Number.isInteger, { error }).describe(description);
}

export type TodoStatus = "pending" | "inProgress" | "completed";

export interface Todo {
  content: string;
  status: TodoStatus;
}

export interface ToolContext {
  cwd: string;
  signal?: AbortSignal;
  toolCallId?: string;
}

export type AgentLevel = 0 | 1 | 2;

export function isGrantedAtLevel(agentLevel: AgentLevel | undefined, maxLevel: AgentLevel): boolean {
  return agentLevel !== undefined && agentLevel >= 1 && agentLevel <= maxLevel;
}

export interface Tool {
  name: string;
  agentLevel?: AgentLevel;
  concurrencySafe?: boolean;
  description: string;
  parameters: Record<string, unknown>;
  argSummaryKeys?: string[];
  truncate?: "head" | "tail";
  maxResultSizeBytes?: number;
  persist?: boolean;
  summarizeArgs?: (args: Record<string, unknown>) => string;
  summarizeResult?(result: ToolResult): string;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
