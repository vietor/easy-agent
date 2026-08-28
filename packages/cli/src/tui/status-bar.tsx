import { memo } from "react";
import { Box, Text, useWindowSize } from "ink";
import { formatCompactNumber } from "@vietor/agent-core/util";

interface StatusBarProps {
  contextTokens: number;
  contextLimit: number;
  running: boolean;
  questionPending: boolean;
  thinkingAvailable: boolean;
  cacheInputTokens: number;
  missInputTokens: number;
  outputTokens: number;
}

export const StatusBar = memo(function StatusBar({ contextTokens, contextLimit, running, questionPending, thinkingAvailable, cacheInputTokens, missInputTokens, outputTokens }: StatusBarProps) {
  const { columns } = useWindowSize();
  const pct = Math.min(100, contextLimit > 0 ? Math.round((contextTokens / contextLimit) * 100) : 0);
  const filled = Math.round((pct / 100) * 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  const ctxColor = pct >= 85 ? "red" : pct >= 60 ? "yellow" : "green";
  let hints: string;
  if (questionPending) hints = "↑↓ select · tab switch · space toggle · enter confirm · esc skip";
  else if (running) hints = thinkingAvailable ? "esc stop · t thinking" : "esc stop";
  else hints = "/ commands";
  return (
    <Box width={columns} paddingX={1} flexDirection="row" justifyContent="space-between" borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Box flexDirection="row">
        <Text>
          <Text dimColor>{`Context ${formatCompactNumber(contextTokens)} `}</Text>
          <Text color={ctxColor}>{`▕${bar}▏ ${pct}%`}</Text>
        </Text>
        <Text dimColor>  Tokens ↑({formatCompactNumber(cacheInputTokens)} / {formatCompactNumber(missInputTokens)}) · ↓{formatCompactNumber(outputTokens)}</Text>
      </Box>
      <Text dimColor>{hints}</Text>
    </Box>
  );
});
