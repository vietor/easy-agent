import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { RunMetrics, Session } from "@vietor/agent-core";
import { Markdown } from "./components/markdown.js";
import { QuestionView } from "./question-view.js";
import { Spinner } from "./spinner.js";

interface RunningViewProps {
  session: Session;
  runMetrics: RunMetrics;
  streaming: string;
  thinking: string;
  showThinking: boolean;
}

export function RunningView({ session, runMetrics, streaming, thinking, showThinking }: RunningViewProps) {
  const pendingQuestion = session.pendingQuestion;
  if (pendingQuestion) {
    return (
      <QuestionView
        question={pendingQuestion}
        onAnswer={(ans) => session.submitAnswer(pendingQuestion.id, ans)}
      />
    );
  }
  const spinnerLabel = streaming ? "replying" : "working";
  return (
    <>
      {thinking ? renderThinking(thinking, showThinking) : null}
      {streaming ? (
        <Box marginTop={1} paddingLeft={1} paddingRight={1}>
          <Markdown>{streaming}</Markdown>
        </Box>
      ) : null}
      <Box marginTop={1} paddingLeft={1}>
        <Spinner label={spinnerLabel} thinkingElapsed={runMetrics.thinkingElapsed} replyElapsed={runMetrics.replyElapsed} inputTokens={runMetrics.inputTokens} outputTokens={runMetrics.outputTokens} />
      </Box>
    </>
  );
}

function renderThinking(text: string, expanded: boolean): ReactNode {
  const lines = text.split("\n");
  const firstLine = (lines[0] ?? "").slice(0, 80);
  if (expanded) {
    return (
      <Box marginTop={1} paddingLeft={1} flexDirection="column">
        <Text dimColor>┊ thinking (t to collapse)</Text>
        <Box paddingLeft={1}>
          <Text dimColor>{text}</Text>
        </Box>
      </Box>
    );
  }
  const extra = lines.length > 1 ? ` …+${lines.length - 1} lines` : "";
  return (
    <Box marginTop={1} paddingLeft={1}>
      <Text dimColor>┊ {firstLine}{extra} (t to expand)</Text>
    </Box>
  );
}
