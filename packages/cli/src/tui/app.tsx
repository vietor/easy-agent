import { useMemo, useSyncExternalStore } from "react";
import { Box, render, useApp, useInput, useWindowSize } from "ink";
import { type Session, type SessionView } from "@vietor/agent-core";
import { toErrorMessage } from "@vietor/agent-core/util";
import { executeSlashCommand, slashCommandInfos } from "../commands/dispatch.js";
import { useSessionStream } from "./use-session-stream.js";
import { RunningView } from "./running-view.js";
import { TimelineView } from "./timeline-view.js";
import { TodoView } from "./todo-view.js";
import { AppHeader } from "./app-header.js";
import { PromptOrCommandInput } from "./prompt-or-command-input.js";
import { StatusBar } from "./status-bar.js";

export function App({ session }: { session: Session }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot) as SessionView;
  const { runMetrics, streaming, thinking, showThinking, setShowThinking } = useSessionStream(session);
  const allCmds = useMemo(() => slashCommandInfos(session), [session]);
  const pendingQuestion = session.pendingQuestion;

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

      {runMetrics.running ? (
        <RunningView
          session={session}
          runMetrics={runMetrics}
          streaming={streaming.text}
          thinking={thinking.text}
          showThinking={showThinking}
        />
      ) : null}

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

export function startApp(session: Session): ReturnType<typeof render> {
  return render(<App session={session} />, { exitOnCtrlC: false, incrementalRendering: true });
}
