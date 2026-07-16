import { memo } from "react";
import { Box, Text, useWindowSize } from "ink";
import { compactDisplay } from "../util/format.js";

interface StatusBarProps {
  contextTokens: number;
}

export const StatusBar = memo(function StatusBar({ contextTokens }: StatusBarProps) {
  const { columns } = useWindowSize();
  return (
    <Box width={columns} paddingX={1} flexDirection="row">
      <Text dimColor>
        Context: {compactDisplay(contextTokens)} tokens · ESC to stop · / for commands
      </Text>
    </Box>
  );
});
