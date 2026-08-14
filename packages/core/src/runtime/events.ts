export interface RunMetrics {
  running: boolean;
  elapsed: number;
  thinkingElapsed: number;
  replyElapsed: number;
  inputTokens: number;
  outputTokens: number;
}

export const INITIAL_RUN_METRICS: RunMetrics = { running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, inputTokens: 0, outputTokens: 0 };

export type StreamEvent =
  | { type: "user"; text: string }
  | { type: "skill"; name: string }
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_clear" }
  | { type: "assistant"; text: string }
  | { type: "tool_start"; id: string; name: string; argsSummary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; resultSummary?: string }
  | { type: "retry"; attempt: number; max: number; reason: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; text: string; options: string[] }
  | { type: "notice"; text: string }
  | ({ type: "run_metrics" } & RunMetrics);
