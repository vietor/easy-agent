import type { RunMetrics } from "./events.js";

export class RunTimer {
  private startTime = 0;

  begin(): void {
    this.startTime = Date.now();
  }

  metrics(
    usage: { inputTokens: number; outputTokens: number },
    firstReplyAt: number | null,
    running: boolean
  ): RunMetrics {
    const now = Date.now();
    const elapsed = Math.floor((now - this.startTime) / 1000);
    if (firstReplyAt === null) {
      return { running, elapsed, thinkingElapsed: elapsed, replyElapsed: 0, ...usage };
    }
    return {
      running,
      elapsed,
      thinkingElapsed: Math.floor((firstReplyAt - this.startTime) / 1000),
      replyElapsed: Math.floor((now - firstReplyAt) / 1000),
      ...usage,
    };
  }
}
