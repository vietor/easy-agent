import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Session } from "../core/session.js";
import { Markdown } from "./components/Markdown.js";
import { LogView } from "./LogView.js";
import { AppHeader } from "./AppHeader.js";
import { PromptOrCommandInput } from "./PromptOrCommandInput.js";
import { Spinner } from "./Spinner.js";
import { compactDisplay } from "../util/format.js";

const STREAM_FRAME_MS = 240;

export function App({ session }: { session: Session }) {
  const { exit } = useApp();
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ prompt: 0, completion: 0 });
  const [, setTick] = useState(0);
  const streamingRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const allCmds = useMemo(() => session.commandSchemas, [session]);

  useEffect(() => {
    session.setCallbacks({
      onStreaming: (text) => {
        streamingRef.current = text;
        scheduleStreamingRender();
      },
      onRunStateChange: (r) => setRunning(r),
      onElapsedChange: (s) => setElapsed(s),
      onUsageChange: (p, c) => setUsage({ prompt: p, completion: c }),
    });
  }, []);

  const cancelStreamingRender = () => {
    if (renderTimerRef.current) {
      clearTimeout(renderTimerRef.current);
      renderTimerRef.current = undefined;
    }
  };

  const scheduleStreamingRender = () => {
    if (renderTimerRef.current) return;
    renderTimerRef.current = setTimeout(() => {
      renderTimerRef.current = undefined;
      setTick((t) => t + 1);
    }, STREAM_FRAME_MS);
  };

  useInput((_input, key) => {
    if (key.escape) {
      session.abort();
    } else if (key.ctrl && _input === "c") {
      if (running) session.abort();
      else exit();
    }
  });

  async function handleCommand(name: string) {
    await session.executeCommand(name, { exit, setRunning });
  }

  async function handlePrompt(text: string) {
    if (session.isCommand(text)) {
      await handleCommand(text);
    } else {
      await session.startPrompt(text);
    }
  }

  return (
    <Box flexDirection="column" minWidth={80}>
      <AppHeader />

      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {session.logEntries.map((entry, i) => (
          <LogView key={i} entry={entry} />
        ))}
      </Box>

      {running && streamingRef.current ? (
        <Box paddingLeft={1} paddingRight={1}>
          <Markdown color="green">{streamingRef.current}</Markdown>
        </Box>
      ) : null}

      {running && !streamingRef.current ? (
        <Box marginTop={1} paddingLeft={1}>
          <Spinner label="thinking" elapsed={elapsed} promptTokens={usage.prompt} completionTokens={usage.completion} />
        </Box>
      ) : null}

      {!running ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>[CTX {compactDisplay(session.contextTokens)}] · ESC to stop · "/quit" to leave</Text>
          <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} />
        </Box>
      ) : null}
    </Box>
  );
}

export function startApp(session: Session): ReturnType<typeof render> {
  process.stdout.write("[2J[H");
  return render(<App session={session} />, { exitOnCtrlC: false });
}
