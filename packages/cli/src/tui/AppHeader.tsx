import { memo } from "react";
import { Box, Text, useWindowSize } from "ink";
import type { ReasoningEffort } from "@vietor/easy-agent-core";
import { getPackageInfo } from "../util/package.js";

export const AppHeader = memo(function AppHeader({ cwd, model, reasoningEffort }: { cwd: string; model: string; reasoningEffort: ReasoningEffort }) {
  const { columns } = useWindowSize();
  const pkginfo = getPackageInfo();
  const reasoning = reasoningEffort !== "none" ? ` · reasoning ${reasoningEffort}` : "";
  return (
    <Box width={columns} paddingX={1} flexDirection="column" borderStyle="single" borderBottom borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
      <Box flexDirection="row" justifyContent="space-between">
        <Text><Text bold>Easy Agent</Text><Text dimColor> v{pkginfo.version}</Text></Text>
        <Text dimColor>{`${model}${reasoning}`}</Text>
      </Box>
      <Text dimColor>{cwd}</Text>
    </Box>
  );
});
