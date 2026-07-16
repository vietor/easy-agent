import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Box, render, useApp, useInput, useWindowSize } from "ink";
import type { Session, RunState, SessionEvent, SessionView } from "@vietor/easy-agent-core";
import { Markdown } from "./components/Markdown.js";
import { TimelineList } from "./TimelineList.js";
import { TodoView } from "./TodoView.js";
import { AppHeader } from "./AppHeader.js";
import { PromptOrCommandInput } from "./PromptOrCommandInput.js";
import { QuestionView } from "./QuestionView.js";
import { Spinner } from "./Spinner.js";
import { StatusBar } from "./StatusBar.js";

const STREAM_FRAME_MS = 120;

export function App({ session }: { session: Session }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot) as SessionView;
  const [runState, setRunState] = useState<RunState>({ running: false, elapsed: 0, promptTokens: 0, completionTokens: 0 });
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const allCmds = useMemo(() => session.commandSchemas, [session]);
  const pendingQuestion = session.getPendingQuestion();

  useEffect(() => {
    const unsub = session.subscribeEvents((e: SessionEvent) => {
      switch (e.type) {
        case "assistant_delta":
          streamingRef.current += e.text;
          scheduleStreamingRender();
          break;
        case "assistant":
          streamingRef.current = "";
          setStreamingText("");
          break;
        case "state":
          setRunState(e);
          break;
      }
    });
    return unsub;
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
      if (runState.running) session.abort();
      else exit();
    }
  });

  async function handleCommand(name: string, args: string) {
    await session.executeCommand(name, args);
    if (session.localStore.get("exitRequested") != null) exit();
  }

  async function handlePrompt(text: string) {
    const [first, ...rest] = text.split(/\s+/);
    if (first.startsWith("/") || session.isCommand(first)) {
      const name = first.startsWith("/") ? first.slice(1) : first;
      await handleCommand(name, rest.join(" "));
    } else {
      await session.startPrompt(text);
    }
  }

  let runningView: ReactNode = null;
  if (runState.running) {
    if (pendingQuestion) {
      runningView = (
        <QuestionView
          question={pendingQuestion}
          onAnswer={(ans) => session.submitAnswer(pendingQuestion.id, ans)}
        />
      );
    } else if (streamingText) {
      runningView = (
        <Box marginTop={1} paddingLeft={1} paddingRight={1} borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor="gray">
          <Markdown color="green">{streamingText}</Markdown>
        </Box>
      );
    } else {
      runningView = (
        <Box marginTop={1} paddingLeft={1}>
          <Spinner label="thinking" elapsed={runState.elapsed} promptTokens={runState.promptTokens} completionTokens={runState.completionTokens} />
        </Box>
      );
    }
  }

  return (
    <Box width={columns} flexDirection="column">
      <AppHeader />

      <TimelineList session={session} />

      {view.todos.length > 0 ? <TodoView todos={view.todos} /> : null}

      {runningView}

      {!runState.running ? (
        <>
          <StatusBar contextTokens={session.contextTokens} />
          <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} />
        </>
      ) : null}
    </Box>
  );
}

export function startApp(session: Session): ReturnType<typeof render> {
  process.stdout.write("[2J[H");
  return render(<App session={session} />, { exitOnCtrlC: false, incrementalRendering: true });
}
