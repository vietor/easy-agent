import type { AskedQuestion } from "../tools/ask-user.js";

export interface RunMetrics {
  running: boolean;
  elapsed: number;
  thinkingElapsed: number;
  replyElapsed: number;
  cacheInputTokens: number;
  missInputTokens: number;
  outputTokens: number;
}

export const INITIAL_RUN_METRICS: RunMetrics = { running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, cacheInputTokens: 0, missInputTokens: 0, outputTokens: 0 };

export type TimelineEvent =
  | { type: "user"; text: string }
  | { type: "skill"; name: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; argsSummary: string; result: string | null; isError?: boolean; resultSummary?: string }
  | { type: "retry"; attempt: number; max: number; reason: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; questions: AskedQuestion[] }
  | { type: "notice"; text: string };

export type StreamEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_cleared" }
  | { type: "tool_start"; id: string; name: string; argsSummary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; resultSummary?: string }
  | ({ type: "run_metrics" } & RunMetrics);

export type SessionEvent = TimelineEvent | StreamEvent;
