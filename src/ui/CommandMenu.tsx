import { Box, Text } from "ink";
import type { Command } from "../core/command.js";

interface CommandMenuProps {
  show: boolean;
  selectedIndex: number;
  commands: Command[];
}

export function CommandMenu({ show, selectedIndex, commands }: CommandMenuProps) {
  if (!show || selectedIndex < 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      {commands.map((cmd, i) => (
        <Box key={cmd.name}>
          <Text color={i === selectedIndex ? "cyan" : undefined}>
            {i === selectedIndex ? "▸ " : "  "}/{cmd.name}
          </Text>
          <Text dimColor>  {cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
