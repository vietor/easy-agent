import { useEffect, useRef, useState } from "react";
import { INITIAL_RUN_METRICS, type AgentEvent, type RunMetrics, type Session } from "@vietor/agent-core";

const STREAM_FRAME_MS = 120;

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
  const streaming = useThrottledText(STREAM_FRAME_MS);
  const thinking = useThrottledText(STREAM_FRAME_MS);
  const [showThinking, setShowThinking] = useState(false);

  useEffect(() => {
    const unsub = session.onEvent((e: AgentEvent) => {
      switch (e.type) {
        case "assistantDelta":
          streaming.append(e.text);
          break;
        case "thinkingDelta":
          thinking.append(e.text);
          break;
        case "thinkingClear":
          thinking.reset();
          break;
        case "assistant":
        case "retry":
        case "interrupted":
          streaming.reset();
          break;
        case "runMetrics":
          setRunMetrics(e);
          break;
      }
    });
    return unsub;
  }, [session]);

  return { runMetrics, streaming, thinking, showThinking, setShowThinking };
}
