import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Session } from "@vietor/easy-agent-core";
import { Markdown } from "./components/Markdown.js";
import { LogList } from "./LogList.js";
import { TodoView } from "./TodoView.js";
import { AppHeader } from "./AppHeader.js";
import { PromptOrCommandInput } from "./PromptOrCommandInput.js";
import { QuestionView } from "./QuestionView.js";
import { Spinner } from "./Spinner.js";
import type { LogEntry } from "@vietor/easy-agent-core";
import { compactDisplay } from "../util/format.js";

const STREAM_FRAME_MS = 120;

export function App({ session }: { session: Session }) {
  const { exit } = useApp();
  const version = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [running, setRunning] = useState(false);
  const [runElapsed, setRunElapsed] = useState(0);
  const [runUsage, setRunUsage] = useState({ prompt: 0, completion: 0 });
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const allCmds = useMemo(() => session.commandSchemas, [session]);
  const pendingQuestion = useMemo(
    () =>
      session.logEntries.find(
        (e): e is Extract<LogEntry, { kind: "question" }> => e.kind === "question" && e.answer === null,
      ),
    [session, version],
  );

  useEffect(() => {
    session.setCallbacks({
      onStreaming: (text) => {
        streamingRef.current = text;
        scheduleStreamingRender();
      },
      onRunStateChange: (r) => setRunning(r),
      onRunElapsedChange: (s) => setRunElapsed(s),
      onRunUsageChange: (p, c) => setRunUsage({ prompt: p, completion: c }),
    });
  }, []);

  const scheduleStreamingRender = () => {
    if (renderTimerRef.current) return;
    renderTimerRef.current = setTimeout(() => {
      renderTimerRef.current = undefined;
      setStreamingText(streamingRef.current);
    }, STREAM_FRAME_MS);
  };

  useInput((_input, key) => {
    if (pendingQuestion) {
      if (key.ctrl && _input === "c") session.abort();
      return;
    }
    if (key.escape) {
      session.abort();
    } else if (key.ctrl && _input === "c") {
      if (running) session.abort();
      else exit();
    }
  });

  async function handleCommand(name: string) {
    if (await session.executeCommand(name) === "exit") exit();
  }

  async function handlePrompt(text: string) {
    if (session.isCommand(text)) {
      await handleCommand(text);
    } else {
      await session.startPrompt(text);
    }
  }

  let runningView: ReactNode = null;
  if (running) {
    if (pendingQuestion) {
      runningView = (
        <QuestionView
          question={pendingQuestion}
          onAnswer={(ans) => session.submitAnswer(pendingQuestion.id, ans)}
        />
      );
    } else if (streamingText) {
      runningView = (
        <Box marginTop={1} paddingLeft={1} paddingRight={1}>
          <Markdown color="green">{streamingText}</Markdown>
        </Box>
      );
    } else {
      runningView = (
        <Box marginTop={1} paddingLeft={1}>
          <Spinner label="thinking" elapsed={runElapsed} promptTokens={runUsage.prompt} completionTokens={runUsage.completion} />
        </Box>
      );
    }
  }

  return (
    <Box flexDirection="column" minWidth={80}>
      <AppHeader />

      <LogList session={session} />

      {session.todos.length > 0 ? <TodoView todos={session.todos} /> : null}

      {runningView}

      {!running ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>[CTX {compactDisplay(session.contextTokens)}] · ESC to stop · type / for commands</Text>
          <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} />
        </Box>
      ) : null}
    </Box>
  );
}

export function startApp(session: Session): ReturnType<typeof render> {
  process.stdout.write("[2J[H");
  return render(<App session={session} />, { exitOnCtrlC: false, incrementalRendering: true });
}
