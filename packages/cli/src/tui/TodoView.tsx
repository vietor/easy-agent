import { memo } from "react";
import { Box, Text } from "ink";
import type { Todo, TodoStatus } from "@vietor/easy-agent-core";

const ICONS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
};

const COLORS: Record<TodoStatus, string> = {
  pending: "gray",
  in_progress: "yellow",
  completed: "green",
};

export const TodoView = memo(function TodoView({ todos }: { todos: readonly Todo[] }) {
  if (todos.length === 0) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  const headerColor = done === todos.length ? "green" : "cyan";
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />
      <Text color={headerColor}>{`Tasks [${done}/${todos.length}]`}</Text>
      {todos.map((t, i) => (
        <Text key={i} color={COLORS[t.status]} strikethrough={t.status === "completed"}>
          {`${ICONS[t.status]} ${t.content}`}
        </Text>
      ))}
    </Box>
  );
});
