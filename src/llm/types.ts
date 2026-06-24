import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export type Message = ChatCompletionMessageParam;
export type AssistantMessage = ChatCompletionAssistantMessageParam;

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
