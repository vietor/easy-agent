import { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { CommandSchema } from "@vietor/easy-agent-core";

interface PromptOrCommandInputProps {
  commands: CommandSchema[];
  onCommand: (name: string) => void;
  onPrompt: (value: string) => void;
}

const MAX_ITEMS = 4;

export function PromptOrCommandInput({ commands, onCommand, onPrompt }: PromptOrCommandInputProps) {
  const [input, setInput] = useState("");
  const showMenu = input.startsWith("/");
  const prefix = showMenu ? input.slice(1) : "";

  const filtered = useMemo(() => {
    if (!showMenu) return [];
    if (prefix === "") return commands;
    return commands.filter((c) => c.name.startsWith(prefix));
  }, [showMenu, prefix, commands]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((prev) => Math.max(0, Math.min(prev, Math.max(0, filtered.length - 1))));
  }, [filtered.length]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i >= filtered.length - 1 ? 0 : i + 1));
      } else if (key.escape) {
        setInput("");
      }
    },
    { isActive: showMenu },
  );

  const visibleItems = useMemo(() => {
    if (!showMenu || filtered.length === 0) return { start: 0, items: [] as CommandSchema[] };
    const total = filtered.length;
    const half = Math.floor(MAX_ITEMS / 2);
    let start = Math.max(0, selectedIndex - half);
    if (start + MAX_ITEMS > total) start = Math.max(0, total - MAX_ITEMS);
    return { start, items: filtered.slice(start, start + MAX_ITEMS) };
  }, [showMenu, filtered, selectedIndex]);

  const onSubmit = (value: string) => {
    const text = value.trim();
    setInput("");
    if (!text) return;
    if (text.startsWith("/")) {
      if (filtered.length > 0) {
        const cmd = filtered[selectedIndex];
        onCommand(cmd ? cmd.name : prefix);
      }
      return;
    }
    onPrompt(text);
  };

  return (
    <Box flexDirection="column">
      {showMenu && filtered.length > 0 ? (
        <Box flexDirection="column" borderStyle="single" borderColor="gray">
          {visibleItems.items.map((cmd, i) => {
            const realIdx = visibleItems.start + i;
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
      ) : null}
      <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray">
        <Text color="gray">❯ </Text>
        <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
      </Box>
    </Box>
  );
}
