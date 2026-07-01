import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Command } from "../core/command.js";

interface CommandMenuProps {
  input: string;
  commands: Command[];
  onCommand: (name: string) => void;
  onCancel: () => void;
}

const MAX_ITEMS = 4;

export function CommandMenu({ input, commands, onCommand, onCancel }: CommandMenuProps) {
  const show = input.startsWith("/");
  const prefix = show ? input.slice(1) : "";

  const filtered = useMemo(() => {
    if (!show) return [];
    if (prefix === "") return commands;
    return commands.filter((c) => c.name.startsWith(prefix));
  }, [show, prefix, commands]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (filtered.length > 0 && selectedIndex === -1) setSelectedIndex(0);
    else if (selectedIndex >= filtered.length) setSelectedIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i >= filtered.length - 1 ? 0 : i + 1));
      } else if (key.escape) {
        onCancel();
      } else if (key.return) {
        const cmd = filtered[selectedIndex];
        onCommand(cmd ? cmd.name : prefix);
      }
    },
    { isActive: show },
  );

  if (!show || filtered.length === 0) return null;

  const total = filtered.length;
  const half = Math.floor(MAX_ITEMS / 2);
  let start = Math.max(0, selectedIndex - half);
  if (start + MAX_ITEMS > total) start = Math.max(0, total - MAX_ITEMS);
  const visible = filtered.slice(start, start + MAX_ITEMS);

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
