import { memo } from "react";
import { Box, Text } from "ink";
import { type Todo, type TodoStatus } from "@vietor/easy-agent-core";

const GLYPHS: Record<TodoStatus, string> = {
  pending: "○",
  inProgress: "◐",
  completed: "✓",
};

const COLORS: Record<TodoStatus, string> = {
  pending: "gray",
  inProgress: "yellow",
  completed: "green",
};

export const TodoView = memo(function TodoView({ todos }: { todos: readonly Todo[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  const headerColor = done === todos.length ? "green" : "cyan";
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" />
      <Text color={headerColor}>{`Tasks [${done}/${todos.length}]`}</Text>
      {todos.map((t, i) => (
        <Text key={i} color={COLORS[t.status]} strikethrough={t.status === "completed"}>
          {`${GLYPHS[t.status]} ${t.content}`}
        </Text>
      ))}
    </Box>
  );
});
