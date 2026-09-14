import { useEffect, useRef, useState } from "react";
import { INITIAL_RUN_METRICS, type RunMetrics, type Session, type SessionEvent } from "@vietor/agent-core";
import { FRAME_MS } from "./constants.js";

function useThrottledText(frameMs: number) {
  const [text, setText] = useState("");
  const bufRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const append = (t: string) => {
    bufRef.current += t;
    if (timerRef.current === undefined) {
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        setText(bufRef.current);
      }, frameMs);
    }
  };
  const reset = () => {
    bufRef.current = "";
    setText("");
  };
  return { text, append, reset };
}

export function useSessionStream(session: Session) {
  const [runMetrics, setRunMetrics] = useState<RunMetrics>(INITIAL_RUN_METRICS);
  const [totalTokens, setTotalTokens] = useState({ cacheInputTokens: 0, missInputTokens: 0, outputTokens: 0 });
  const streaming = useThrottledText(FRAME_MS);
  const thinking = useThrottledText(FRAME_MS);
  const [showThinking, setShowThinking] = useState(false);

  useEffect(() => {
    const unsub = session.onEvent((e: SessionEvent) => {
      switch (e.type) {
        case "assistant_delta":
          streaming.append(e.text);
          break;
        case "thinking_delta":
          thinking.append(e.text);
          break;
        case "thinking_cleared":
          thinking.reset();
          setShowThinking(false);
          break;
        case "assistant":
        case "retry":
        case "interrupted":
          streaming.reset();
          break;
        case "run_metrics":
          setRunMetrics(e);
          if (!e.running) {
            setTotalTokens((prev) => ({ cacheInputTokens: prev.cacheInputTokens + e.cacheInputTokens, missInputTokens: prev.missInputTokens + e.missInputTokens, outputTokens: prev.outputTokens + e.outputTokens }));
          }
          break;
      }
    });
    return unsub;
  }, [session]);

  const resetMetrics = () => {
    setRunMetrics(INITIAL_RUN_METRICS);
    setTotalTokens({ cacheInputTokens: 0, missInputTokens: 0, outputTokens: 0 });
  };

  return { runMetrics, totalTokens, streaming, thinking, showThinking, setShowThinking, resetMetrics };
}
