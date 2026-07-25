import { memo, useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Markdown } from "./components/Markdown.js";
import type { TimelineEntry } from "@vietor/easy-agent-core";

export const TimelineView = memo(function TimelineView({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text>
            <Text color="cyan">{"> "}</Text>
            {entry.text}
          </Text>
        </Box>
      );
    case "skill":
      return (
        <Box marginTop={1}>
          <Text>
            <Text color="magenta">◈ </Text>
            <Text dimColor>skill </Text>
            <Text color="magenta" bold>{entry.name}</Text>
          </Text>
        </Box>
      );
    case "assistant":
      return (
        <Box marginTop={1}>
          <Markdown>{entry.text}</Markdown>
        </Box>
      );
    case "tool":
      return <ToolEntry entry={entry} />;
    case "retry":
      return (
        <Box>
          <Text>
            <Text color="yellow">↻ </Text>
            <Text dimColor>retry {entry.attempt}/{entry.max}</Text>
          </Text>
        </Box>
      );
    case "error":
      return (
        <Box marginTop={1}>
          <Text color="red">
            <Text bold>✗ </Text>
            {entry.text}
          </Text>
        </Box>
      );
    case "interrupted":
      return (
        <Box>
          <Text>
            <Text color="yellow">◼ </Text>
            <Text dimColor>interrupted</Text>
          </Text>
        </Box>
      );
    case "question":
      if (entry.answer === null) return null;
      return (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">{`? ${entry.text}`}</Text>
          <Text dimColor>{`  ⎿  ${entry.answer || "(skipped)"}`}</Text>
        </Box>
      );
    case "system":
      return (
        <Box>
          <Text color="blue">{entry.text}</Text>
        </Box>
      );
  }
});

function ToolEntry({ entry }: { entry: Extract<TimelineEntry, { kind: "tool" }> }) {
  const running = entry.result === null;
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(id);
  }, [running]);

  const icon = running ? (on ? "●" : " ") : "●";
  const iconColor = running ? "cyan" : entry.isError ? "red" : "green";
  const nameColor = entry.isError ? "red" : "yellow";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={iconColor}>{`${icon} `}</Text>
        <Text bold color={nameColor}>{entry.name}</Text>
        {entry.summary ? <Text dimColor>{`(${entry.summary})`}</Text> : null}
      </Text>
      {entry.result !== null ? (
        <Text color={entry.isError ? "red" : "gray"}>{`  ⎿  ${entry.preview}`}</Text>
      ) : null}
    </Box>
  );
}
