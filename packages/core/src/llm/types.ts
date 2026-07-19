export type ReasoningEffort = "high" | "max";

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null | TextContentPart[];
  tool_calls?: ToolCall[];
}

export type Message =
  | { role: "system"; content: string | TextContentPart[] }
  | { role: "user"; content: string | TextContentPart[]; name?: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };
