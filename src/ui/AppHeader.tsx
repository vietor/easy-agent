import { Box, Text } from "ink";
import { getPackageInfo } from "../util/package.js";

const pkginfo = getPackageInfo();

export function AppHeader() {
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="red" bold>
          Easy Agent
        </Text>
        <Text dimColor> v{pkginfo.version}</Text>
      </Box>
      <Text dimColor>{process.cwd()}</Text>
    </Box>
  );
}
