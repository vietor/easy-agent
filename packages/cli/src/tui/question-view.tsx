import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { AskAnswer, TimelineEvent } from "@vietor/agent-core";

interface QuestionViewProps {
  question: Extract<TimelineEvent, { type: "question" }>;
  onAnswer: (answers: AskAnswer[]) => void;
}

const CUSTOM_LABEL = "✎ Custom input";

function nextUnconfirmed(from: number, confirmed: boolean[]): number {
  for (let i = 1; i <= confirmed.length; i++) {
    const idx = (from + i) % confirmed.length;
    if (!confirmed[idx]) return idx;
  }
  return from;
}

export function QuestionView({ question, onAnswer }: QuestionViewProps) {
  const starts: number[] = [];
  {
    let acc = 0;
    for (const q of question.questions) {
      starts.push(acc);
      acc += q.options.length;
    }
  }
  const [focus, setFocus] = useState(0);
  const [selected, setSelected] = useState(0);
  const [inputting, setInputting] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [answers, setAnswers] = useState<AskAnswer[]>(() => question.questions.map(() => ""));
  const [confirmed, setConfirmed] = useState<boolean[]>(() => question.questions.map(() => false));
  const [customText, setCustomText] = useState<(string | null)[]>(() => question.questions.map(() => null));
  const [text, setText] = useState("");

  const submitWith = (next: AskAnswer[], nextConfirmed: boolean[]): void => {
    if (nextConfirmed.every(Boolean)) onAnswer(next);
    else setFocus(nextUnconfirmed(focus, nextConfirmed));
  };

  const confirmCurrent = (next: AskAnswer[]): void => {
    const nextConfirmed = [...confirmed];
    nextConfirmed[focus] = true;
    setAnswers(next);
    setConfirmed(nextConfirmed);
    submitWith(next, nextConfirmed);
  };

  useInput((input, key) => {
    if (inputting) {
      if (key.escape) setInputting(false);
      return;
    }
    const q = question.questions[focus];
    const itemCount = q.options.length + 1;
    if (key.upArrow) {
      setSelected((i) => (i <= 0 ? itemCount - 1 : i - 1));
    } else if (key.downArrow) {
      setSelected((i) => (i >= itemCount - 1 ? 0 : i + 1));
    } else if (key.tab || key.rightArrow) {
      setFocus((f) => (f + 1) % question.questions.length);
      setSelected(0);
    } else if ((key.tab && key.shift) || key.leftArrow) {
      setFocus((f) => (f <= 0 ? question.questions.length - 1 : f - 1));
      setSelected(0);
    } else if (key.return) {
      if (confirmed[focus]) {
        if (confirmed.every(Boolean)) onAnswer(answers);
        else setFocus(nextUnconfirmed(focus, confirmed));
      } else if (selected === q.options.length) {
        if (customText[focus] !== null) {
          const answer = q.multiSelect
            ? [...q.options.filter((_, i) => checked.has(starts[focus] + i)).map((o) => o.label), customText[focus]!]
            : customText[focus]!;
          confirmCurrent([...answers.slice(0, focus), answer, ...answers.slice(focus + 1)]);
        } else {
          setText("");
          setInputting(true);
        }
      } else {
        const answer = q.multiSelect
          ? q.options.filter((_, i) => checked.has(starts[focus] + i)).map((o) => o.label)
          : q.options[selected].label;
        confirmCurrent([...answers.slice(0, focus), answer, ...answers.slice(focus + 1)]);
      }
    } else if (input === " ") {
      if (q.multiSelect) {
        if (selected < q.options.length) {
          const gi = starts[focus] + selected;
          setChecked((s) => {
            const next = new Set(s);
            if (next.has(gi)) next.delete(gi);
            else next.add(gi);
            return next;
          });
        } else if (customText[focus] !== null) {
          setCustomText((c) => {
            const nc = [...c];
            nc[focus] = null;
            return nc;
          });
        }
      }
    } else if (key.escape) {
      onAnswer(question.questions.map(() => ""));
    } else if (input && !key.ctrl && !key.meta) {
      setText(input);
      setSelected(q.options.length);
      setInputting(true);
    }
  });

  const q = question.questions[focus];
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1} paddingRight={1}>
      <Box flexDirection="row">
        {question.questions.map((q, qi) => (
          <Text key={qi} color={qi === focus ? "cyan" : "gray"} bold={qi === focus}>
            {` ${qi === focus ? "▸" : " "}[${confirmed[qi] ? "✓ " : ""}${q.header ?? `Q${qi + 1}`}]`}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">
          {`? ${q.question}`}
          {q.multiSelect ? <Text dimColor> (multi)</Text> : null}
        </Text>
        {q.options.map((opt, oi) => {
          const gi = starts[focus] + oi;
          const isSelected = oi === selected;
          const isChecked = checked.has(gi);
          const prefix = q.multiSelect ? (isChecked ? "[✓] " : "[ ] ") : isSelected ? "▸ " : "  ";
          const color = isSelected || isChecked ? "cyan" : undefined;
          return (
            <Box key={oi} flexDirection="column">
              <Text color={color}>{`${prefix}${opt.label}`}</Text>
              {opt.description ? <Text dimColor>{`    ${opt.description}`}</Text> : null}
            </Box>
          );
        })}
        {inputting ? (
          <Box flexDirection="row">
            <Text color="gray">❯ </Text>
            <TextInput
              value={text}
              onChange={setText}
              onSubmit={() => {
                setCustomText((c) => {
                  const nc = [...c];
                  nc[focus] = text;
                  return nc;
                });
                setInputting(false);
              }}
            />
          </Box>
        ) : (
          <Text color={selected === q.options.length ? "cyan" : undefined}>
            {`${q.multiSelect ? (customText[focus] !== null ? "[✓] " : "[ ] ") : selected === q.options.length ? "▸ " : "  "}${customText[focus] ? `${CUSTOM_LABEL}: ${customText[focus]!.slice(0, 40)}` : CUSTOM_LABEL}`}
          </Text>
        )}
      </Box>
    </Box>
  );
}
