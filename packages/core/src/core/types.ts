import type { ConversationMessage } from "./conversation.js";
import type { Tool, Todo } from "../tools/types.js";
import type { BuiltInToolsOptions } from "../tools/registry.js";
import type { Skill } from "../skills/types.js";
import type { MCPServerConfig } from "../mcp/types.js";
import type { LLMConfig } from "../llm/types.js";

export interface SessionData {
  messages: ConversationMessage[];
  todos: Todo[];
}

export interface SessionMeta {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
}

export interface SessionPersistence {
  load(sessionId: string): Promise<SessionData | null>;
  saveAll(sessionId: string, state: SessionData): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  delete?(sessionId: string): Promise<void>;
}

export interface SessionOptions {
  systemPrompt: string;
  llmConfig: LLMConfig;
  cwd?: string;
  tools?: Tool[];
  skills?: Skill[];
  mcpServers?: Record<string, MCPServerConfig>;
  builtinTools?: BuiltInToolsOptions | false;
  clientInfo?: { name: string; version: string };
  sessionId?: string;
  persistence?: SessionPersistence;
  maxTurns?: number;
  stallThreshold?: number;
}

export interface RunState {
  running: boolean;
  elapsed: number;
  thinkingElapsed: number;
  replyElapsed: number;
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | { type: "user"; text: string }
  | { type: "skill"; name: string }
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "reasoning_clear" }
  | { type: "assistant"; text: string }
  | { type: "tool_start"; id: string; name: string; argsSummary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; resultSummary?: string }
  | { type: "retry"; attempt: number; max: number; reason: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; text: string; options: string[] }
  | { type: "question_answered"; id: string; answer: string }
  | { type: "notice"; text: string }
  | ({ type: "run_state" } & RunState);
