import { useEffect, useState } from "react";
import { Text } from "ink";
import { formatCompactNumber, formatDuration } from "@vietor/agent-core/util";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({
  label,
  thinkingElapsed,
  replyElapsed,
  inputTokens,
  outputTokens,
}: {
  label: string;
  thinkingElapsed: number;
  replyElapsed: number;
  inputTokens: number;
  outputTokens: number;
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Text>
      <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
      <Text> {label}</Text>
      <Text dimColor> · work {formatDuration(thinkingElapsed)} · reply {formatDuration(replyElapsed)} · ↑{formatCompactNumber(inputTokens)} · ↓{formatCompactNumber(outputTokens)}</Text>
    </Text>
  );
}
