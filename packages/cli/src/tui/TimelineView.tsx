import { memo } from "react";
import { Box, Text } from "ink";
import { Markdown } from "./components/Markdown.js";
import type { TimelineEntry } from "@vietor/easy-agent-core";

function preview(isError: boolean, text: string): string {
  if (isError) {
    const previewText = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return previewText.length > 100 ? previewText.slice(0, 100) + "…" : previewText;
  }

  const lineCount = text.length === 0 ? 0 : (text.match(/\n/g) || []).length + 1;
  const byteCount = Buffer.byteLength(text, "utf-8");
  return `Result: ${byteCount} bytes, ${lineCount} lines`;
}

export const TimelineView = memo(function Entry({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text>
            <Text color="cyan">❯ </Text>
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
          <Markdown color="green">{entry.text}</Markdown>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color="yellow">● </Text>
            <Text color="yellow" bold>{entry.name}</Text>
            {entry.summary ? <Text dimColor> {entry.summary}</Text> : null}
          </Text>
          {entry.result !== null ? (
            <Text color={entry.isError ? "red" : "gray"}>{`  ${preview(entry.isError ?? false, entry.result)}`}</Text>
          ) : null}
        </Box>
      );
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
          <Text dimColor>{`  › ${entry.answer || "(skipped)"}`}</Text>
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
