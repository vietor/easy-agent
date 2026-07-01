import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface PromptInputProps {
  input: string;
  setInput: (value: string) => void;
  onPrompt: (value: string) => void;
}

export function PromptInput({ input, setInput, onPrompt }: PromptInputProps) {
  const onSubmit = (value: string) => {
    const text = value.trim();
    setInput("");
    if (!text) return;
    if (text.startsWith("/")) return;
    onPrompt(text);
  };

  return (
    <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray">
      <Text color="gray">❯ </Text>
      <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
    </Box>
  );
}
