import { memo } from "react";
import { Box, Text, useWindowSize } from "ink";
import { getPackageInfo } from "../util/package.js";

export const AppHeader = memo(function AppHeader({ cwd }: { cwd: string }) {
  const { columns } = useWindowSize();
  const pkginfo = getPackageInfo();
  return (
    <Box width={columns} paddingX={1} flexDirection="column">
      <Box>
        <Text bold>Easy Agent</Text><Text dimColor> v{pkginfo.version}</Text>
      </Box>
      <Text dimColor>{cwd}</Text>
    </Box>
  );
});
