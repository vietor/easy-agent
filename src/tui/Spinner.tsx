import { useEffect, useState } from "react";
import { Text } from "ink";
import { compactDisplay } from "../util/format.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label, elapsed, promptTokens, completionTokens }: { label: string; elapsed: number; promptTokens: number; completionTokens: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Text color="gray">
      {SPINNER_FRAMES[frame]} {label} · {elapsed}s · ↑{compactDisplay(promptTokens)} · ↓{compactDisplay(completionTokens)}
    </Text>
  );
}
