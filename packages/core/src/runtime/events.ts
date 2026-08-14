export interface RunMetrics {
  running: boolean;
  elapsed: number;
  thinkingElapsed: number;
  replyElapsed: number;
  inputTokens: number;
  outputTokens: number;
}

export const INITIAL_RUN_METRICS: RunMetrics = { running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, inputTokens: 0, outputTokens: 0 };

export type AgentEvent =
  | { type: "user"; text: string; persisted: true }
  | { type: "skill"; name: string; persisted: true }
  | { type: "assistant"; text: string; persisted: true }
  | { type: "tool"; id: string; name: string; argsSummary: string; result: string | null; isError?: boolean; resultSummary?: string; persisted: true }
  | { type: "retry"; attempt: number; max: number; reason: string; persisted: true }
  | { type: "error"; text: string; persisted: true }
  | { type: "interrupted"; persisted: true }
  | { type: "question"; id: string; text: string; options: string[]; answer: string | null; persisted: true }
  | { type: "notice"; text: string; persisted: true }
  | { type: "assistant_delta"; text: string; persisted: false }
  | { type: "thinking_delta"; text: string; persisted: false }
  | { type: "thinking_cleared"; persisted: false }
  | { type: "tool_start"; id: string; name: string; argsSummary: string; persisted: false }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; resultSummary?: string; persisted: false }
  | ({ type: "run_metrics"; persisted: false } & RunMetrics);

export type TimelineEvent = Extract<AgentEvent, { persisted: true }>;
