import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface QuestionViewProps {
  question: { id: string; text: string; options: string[] };
  onAnswer: (answer: string) => void;
}

const CUSTOM_LABEL = "✎ Custom input";

export function QuestionView({ question, onAnswer }: QuestionViewProps) {
  const hasOptions = question.options.length > 0;
  const items = hasOptions ? [...question.options, CUSTOM_LABEL] : [];
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"select" | "input">(hasOptions ? "select" : "input");
  const [text, setText] = useState("");

  useInput((input, key) => {
    if (mode === "select") {
      if (key.upArrow) {
        setSelected((i) => (i <= 0 ? items.length - 1 : i - 1));
      } else if (key.downArrow) {
        setSelected((i) => (i >= items.length - 1 ? 0 : i + 1));
      } else if (key.return) {
        if (selected === items.length - 1) setMode("input");
        else onAnswer(items[selected]);
      } else if (key.escape) {
        onAnswer("");
      } else if (input && !key.ctrl && !key.meta) {
        setText(input);
        setMode("input");
      }
    } else if (key.escape) {
      if (hasOptions) setMode("select");
      else onAnswer("");
    }
  });

  if (mode === "input") {
    return (
      <Box flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
        <Text color="cyan">{`? ${question.text}`}</Text>
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray">
          <Text color="gray">❯ </Text>
          <TextInput value={text} onChange={setText} onSubmit={() => onAnswer(text)} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
      <Text color="cyan">{`? ${question.text}`}</Text>
      <Box flexDirection="column" borderStyle="single" borderColor="gray">
        {items.map((item, i) => (
          <Box key={item}>
            <Text color={i === selected ? "cyan" : undefined}>
              {i === selected ? "▸ " : "  "}{item}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
