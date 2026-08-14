import { memo } from "react";
import { Box, Text, useWindowSize } from "ink";
import type { LLMThinkingEffort } from "@vietor/agent-core";
import { getPackageInfo } from "../util/package.js";

export const AppHeader = memo(function AppHeader({ cwd, model, thinkingEffort }: { cwd: string; model: string; thinkingEffort: LLMThinkingEffort }) {
  const { columns } = useWindowSize();
  const pkg = getPackageInfo();
  const thinking = ` · thinking ${thinkingEffort}`;
  return (
    <Box width={columns} paddingX={1} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text><Text bold>Easy Agent</Text><Text dimColor> v{pkg.version}</Text></Text>
        <Text dimColor>{`${model}${thinking}`}</Text>
      </Box>
      <Text dimColor>{cwd}</Text>
    </Box>
  );
});
