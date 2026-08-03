import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import { type Session, type RunState, type SessionEvent, type SessionView } from "@vietor/easy-agent-core";
import { executeCommand, commandSchemas } from "../commands/dispatch.js";
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
  const [runState, setRunState] = useState<RunState>(() => ({ running: false, elapsed: 0, thinkingElapsed: 0, replyElapsed: 0, inputTokens: 0, outputTokens: 0 }));
  const streaming = useThrottledText(STREAM_FRAME_MS);
  const reasoning = useThrottledText(STREAM_FRAME_MS);
  const [showReasoning, setShowReasoning] = useState(false);
  const allCmds = useMemo(() => commandSchemas(session), [session]);
  const pendingQuestion = session.getPendingQuestion();

  useEffect(() => {
    const unsub = session.subscribeEvents((e: SessionEvent) => {
      switch (e.type) {
        case "assistant_delta":
          streaming.append(e.text);
          break;
        case "reasoning_delta":
          reasoning.append(e.text);
          break;
        case "reasoning_clear":
          reasoning.reset();
          break;
        case "assistant":
          streaming.reset();
          break;
        case "retry":
          streaming.reset();
          break;
        case "state":
          setRunState(e);
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
    if (_input === "t" && runState.running && reasoning.text) {
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

  async function handleCommand(name: string) {
    await executeCommand(name, session);
    if (session.localStore.get("exitRequested") != null) exit();
  }

  async function handlePrompt(text: string) {
    try {
      await session.startPrompt(text);
    } catch (e) {
      session.timelineError((e as Error).message);
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
    } else {
      const spinnerLabel = streaming.text ? "replying" : "working";
      runningView = (
        <>
          {reasoning.text ? renderReasoning(reasoning.text, showReasoning) : null}
          {streaming.text ? (
            <Box marginTop={1} paddingLeft={1} paddingRight={1}>
              <Markdown>{streaming.text}</Markdown>
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
        reasoningAvailable={!!reasoning.text}
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
  return render(<App session={session} />, { exitOnCtrlC: false, incrementalRendering: true });
}
