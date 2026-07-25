import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import type { Session, RunState, SessionEvent, SessionView } from "@vietor/easy-agent-core";
import { Markdown } from "./components/Markdown.js";
import { TimelineView } from "./TimelineView.js";
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
  const [runState, setRunState] = useState<RunState>({ running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, inputTokens: 0, outputTokens: 0 });
  const [streamingText, setStreamingText] = useState("");
  const streamingRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [reasoningText, setReasoningText] = useState("");
  const reasoningRef = useRef("");
  const reasoningRenderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [showReasoning, setShowReasoning] = useState(false);
  const allCmds = useMemo(() => session.commandSchemas, [session]);
  const pendingQuestion = session.getPendingQuestion();

  useEffect(() => {
    const unsub = session.subscribeEvents((e: SessionEvent) => {
      switch (e.type) {
        case "assistant_delta":
          streamingRef.current += e.text;
          scheduleStreamingRender();
          break;
        case "reasoning_delta":
          reasoningRef.current += e.text;
          scheduleReasoningRender();
          break;
        case "reasoning_clear":
          reasoningRef.current = "";
          setReasoningText("");
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

  const scheduleReasoningRender = () => {
    if (reasoningRenderTimerRef.current) return;
    reasoningRenderTimerRef.current = setTimeout(() => {
      reasoningRenderTimerRef.current = undefined;
      setReasoningText(reasoningRef.current);
    }, STREAM_FRAME_MS);
  };

  useInput((_input, key) => {
    if (pendingQuestion) {
      if (key.ctrl && _input === "c") session.abort();
      return;
    }
    if (_input === "t" && runState.running && reasoningText) {
      setShowReasoning((v) => !v);
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
    await session.startPrompt(text);
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
    } else {
      const spinnerLabel = streamingText ? "replying" : "thinking";
      runningView = (
        <>
          {reasoningText ? renderReasoning(reasoningText, showReasoning) : null}
          {streamingText ? (
            <Box marginTop={1} paddingLeft={1} paddingRight={1} borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderColor="gray">
              <Markdown>{streamingText}</Markdown>
            </Box>
          ) : null}
          <Box marginTop={1} paddingLeft={1}>
            <Spinner label={spinnerLabel} thinkingElapsed={runState.thinkingElapsed} replyElapsed={runState.replyElapsed} inputTokens={runState.inputTokens} outputTokens={runState.outputTokens} />
          </Box>
        </>
      );
    }
  }

  return (
    <Box width={columns} flexDirection="column">
      <AppHeader cwd={session.cwd} model={session.model} reasoningEffort={session.reasoningEffort} />

      {view.timeline.length > 0? (
        <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
          {view.timeline.map((entry, i) => (
            <TimelineView key={i} entry={entry} />
          ))}
        </Box>
      ): null}

      {runningView}

      {view.todos.length > 0 ? <TodoView todos={view.todos} /> : null}

      {!runState.running ? (
        <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} />
      ) : null}

      <StatusBar
        contextTokens={session.contextTokens}
        contextLimit={session.compactThreshold}
        running={runState.running}
        questionPending={!!pendingQuestion}
        reasoningAvailable={!!reasoningText}
      />
    </Box>
  );
}

function renderReasoning(text: string, expanded: boolean): ReactNode {
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
  process.stdout.write("[2J[H");
  return render(<App session={session} />, { exitOnCtrlC: false, incrementalRendering: true });
}
