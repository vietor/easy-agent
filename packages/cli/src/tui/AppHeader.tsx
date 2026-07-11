import { Box, Text } from "ink";
import { getPackageInfo } from "@vietor/easy-agent-core";

export function AppHeader() {
  const pkginfo = getPackageInfo();
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        <Text color="red" bold>Easy Agent</Text>
        <Text dimColor> v{pkginfo.version}</Text>
      </Box>
      <Text dimColor>{process.cwd()}</Text>
    </Box>
  );
}
