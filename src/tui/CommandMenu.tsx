import { Box, Text } from "ink";
import type { Command } from "../core/command.js";

interface CommandMenuProps {
  show: boolean;
  selectedIndex: number;
  commands: Command[];
  maxItems?: number;
}

export function CommandMenu({ show, selectedIndex, commands, maxItems = 4 }: CommandMenuProps) {
  if (!show || selectedIndex < 0 || commands.length === 0) return null;

  const total = commands.length;
  const half = Math.floor(maxItems / 2);
  let start = Math.max(0, selectedIndex - half);
  if (start + maxItems > total) start = Math.max(0, total - maxItems);
  const visible = commands.slice(start, start + maxItems);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray">
      {visible.map((cmd, i) => {
        const realIdx = start + i;
        return (
          <Box key={cmd.name}>
            <Text color={realIdx === selectedIndex ? "cyan" : undefined}>
              {realIdx === selectedIndex ? "▸ " : "  "}/{cmd.name}
            </Text>
            <Text dimColor>  {cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
