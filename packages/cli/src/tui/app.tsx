import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import { INITIAL_RUN_METRICS, type AgentEvent, type Session, type RunMetrics, type SessionView } from "@vietor/agent-core";
import { toErrorMessage } from "@vietor/agent-core/util";
import { executeSlashCommand, slashCommandInfos } from "../commands/dispatch.js";
import { Markdown } from "./components/markdown.js";
import { TimelineView } from "./timeline-view.js";
import { TodoView } from "./todo-view.js";
import { AppHeader } from "./app-header.js";
import { PromptOrCommandInput } from "./prompt-or-command-input.js";
import { QuestionView } from "./question-view.js";
import { Spinner } from "./spinner.js";
import { StatusBar } from "./status-bar.js";

const STREAM_FRAME_MS = 120;

function useThrottledText(frameMs: number) {
  const [text, setText] = useState("");
  const bufRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const append = (t: string) => {
    bufRef.current += t;
    if (timerRef.current === undefined) {
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        setText(bufRef.current);
      }, frameMs);
    }
  };
  const reset = () => {
    bufRef.current = "";
    setText("");
  };
  return { text, append, reset };
}

export function App({ session }: { session: Session }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot) as SessionView;
  const [runMetrics, setRunMetrics] = useState<RunMetrics>(INITIAL_RUN_METRICS);
  const streaming = useThrottledText(STREAM_FRAME_MS);
  const thinking = useThrottledText(STREAM_FRAME_MS);
  const [showThinking, setShowThinking] = useState(false);
  const allCmds = useMemo(() => slashCommandInfos(session), [session]);
  const pendingQuestion = session.pendingQuestion;

  useEffect(() => {
    const unsub = session.onEvent((e: AgentEvent) => {
      switch (e.type) {
        case "assistantDelta":
          streaming.append(e.text);
          break;
        case "thinkingDelta":
          thinking.append(e.text);
          break;
        case "thinkingClear":
          thinking.reset();
          break;
        case "assistant":
          streaming.reset();
          break;
        case "retry":
        case "interrupted":
          streaming.reset();
          break;
        case "runMetrics":
          setRunMetrics(e);
          break;
      }
    });
    return unsub;
  }, []);

  useInput((_input, key) => {
    if (pendingQuestion) {
      if (key.ctrl && _input === "c") session.abort();
      return;
    }
    if (_input === "t" && runMetrics.running && thinking.text) {
      setShowThinking((v) => !v);
      return;
    }
    if (key.escape) {
      session.abort();
    } else if (key.ctrl && _input === "c") {
      if (runMetrics.running) session.abort();
      else exit();
    }
  });

  async function handleCommand(name: string) {
    await executeSlashCommand(name, session, exit);
  }

  async function handlePrompt(text: string) {
    try {
      await session.prompt(text);
    } catch (e) {
      session.addError(toErrorMessage(e));
    }
  }

  let runningView: ReactNode = null;
  if (runMetrics.running) {
    if (pendingQuestion) {
      runningView = (
        <QuestionView
          question={pendingQuestion}
          onAnswer={(ans) => session.submitAnswer(pendingQuestion.id, ans)}
        />
      );
    } else {
      const spinnerLabel = streaming.text ? "replying" : "working";
      runningView = (
        <>
          {thinking.text ? renderThinking(thinking.text, showThinking) : null}
          {streaming.text ? (
            <Box marginTop={1} paddingLeft={1} paddingRight={1}>
              <Markdown>{streaming.text}</Markdown>
            </Box>
          ) : null}
          <Box marginTop={1} paddingLeft={1}>
            <Spinner label={spinnerLabel} thinkingElapsed={runMetrics.thinkingElapsed} replyElapsed={runMetrics.replyElapsed} inputTokens={runMetrics.inputTokens} outputTokens={runMetrics.outputTokens} />
          </Box>
        </>
      );
    }
  }

  return (
    <Box width={columns} flexDirection="column">
      <AppHeader cwd={session.cwd} model={session.model} thinkingEffort={session.thinkingEffort} />

      {view.timeline.length > 0? (
        <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
          {view.timeline.map((entry, i) => (
            <TimelineView key={i} entry={entry} />
          ))}
        </Box>
      ): null}

      {runningView}

      {view.todos.length > 0 ? <TodoView todos={view.todos} /> : null}

      {!runMetrics.running ? (
        <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} />
      ) : null}

      <StatusBar
        contextTokens={session.contextTokens}
        contextLimit={session.contextLimit}
        running={runMetrics.running}
        questionPending={!!pendingQuestion}
        thinkingAvailable={!!thinking.text}
      />
    </Box>
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

export function startApp(session: Session): ReturnType<typeof render> {
  return render(<App session={session} />, { exitOnCtrlC: false, incrementalRendering: true });
}
