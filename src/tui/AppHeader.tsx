import { Box, Text } from "ink";
import { getPackageInfo } from "../util/package.js";

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
