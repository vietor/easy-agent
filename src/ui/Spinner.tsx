import { useEffect, useState } from "react";
import { Text } from "ink";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function formatCount(count: number) {
  if (!count || isNaN(count)) return "0";
  const formatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  return formatter.format(count);
}

export function Spinner({ label, elapsed, promptTokens, completionTokens }: { label: string; elapsed: number; promptTokens: number; completionTokens: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Text color="gray">
      {SPINNER_FRAMES[frame]} {label} · {elapsed}s · ↑{formatCount(promptTokens)} · ↓{formatCount(completionTokens)}
    </Text>
  );
}
