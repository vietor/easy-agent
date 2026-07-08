import { memo } from "react";
import { Box, Text } from "ink";
import { Markdown } from "./components/Markdown.js";
import type { LogEntry } from "../core/logstore.js";

function preview(isError: boolean, text: string): string {
  if (isError) {
    const previewText = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return previewText.length > 100 ? previewText.slice(0, 100) + "…" : previewText;
  }

  const lineCount = text.length === 0 ? 0 : (text.match(/\n/g) || []).length + 1;
  const byteCount = Buffer.byteLength(text, "utf-8");
  return `Result: ${byteCount} bytes, ${lineCount} lines`;
}

export const LogView = memo(function Entry({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text>{`❯ ${entry.text}`}</Text>
        </Box>
      );
    case "skill":
      return (
        <Box marginTop={1}>
          <Text color="magenta">{`◈ skill: ${entry.name}`}</Text>
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
        <Box flexDirection="column">
          <Text color="yellow">{`● ${entry.name}${entry.summary ? ` ${entry.summary}` : ""}`}</Text>
          {entry.result !== null ? (
            <Text color={entry.isError ? "red" : "gray"}>{`  ${preview(entry.isError ?? false, entry.result)}`}</Text>
          ) : null}
        </Box>
      );
    case "retry":
      return (
        <Box>
          <Text color="yellow">{`↻ Retry ${entry.attempt}/${entry.max}`}</Text>
        </Box>
      );
    case "error":
      return (
        <Box>
          <Text color="red">{`✗ ${entry.text}`}</Text>
        </Box>
      );
    case "interrupted":
      return (
        <Box>
          <Text color="yellow">◼ interrupted</Text>
        </Box>
      );
    case "system":
      return (
        <Box>
          <Text color="gray">{entry.text}</Text>
        </Box>
      );
  }
});
