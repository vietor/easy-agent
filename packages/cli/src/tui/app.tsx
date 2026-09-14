import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Box, render, useApp, useInput, useWindowSize } from "ink";
import { type Session } from "@vietor/agent-core";
import { toErrorMessage } from "@vietor/agent-core/util";
import { executeSlashCommand, slashCommandInfos } from "../commands/dispatch.js";
import { Markdown } from "./markdown.js";
import { useSessionStream } from "./hooks.js";
import { TimelineView } from "./timeline-view.js";
import { TodoView } from "./todo-view.js";
import { ThinkingView } from "./thinking-view.js";
import { AppHeader } from "./app-header.js";
import { PromptOrCommandInput } from "./prompt-or-command-input.js";
import { QuestionView } from "./question-view.js";
import { Spinner } from "./spinner.js";
import { StatusBar } from "./status-bar.js";

export function App({ session, persist }: { session: Session; persist: () => void }) {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { runMetrics, totalTokens, streaming, thinking, showThinking, setShowThinking, resetMetrics } = useSessionStream(session);
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
    await executeSlashCommand(name, session, exit, persist);
    if (name === "clear") resetMetrics();
  }

  async function handlePrompt(text: string) {
    try {
      await session.prompt(text);
      persist();
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
          {thinking.text ? <ThinkingView text={thinking.text} expanded={showThinking} /> : null}
          {streaming.text ? (
            <Box marginTop={1} paddingLeft={1} paddingRight={1}>
              <Markdown>{streaming.text}</Markdown>
            </Box>
          ) : null}
          <Box marginTop={1} paddingLeft={1}>
            <Spinner label={spinnerLabel} thinkingElapsed={runMetrics.thinkingElapsed} replyElapsed={runMetrics.replyElapsed} cacheInputTokens={runMetrics.cacheInputTokens} missInputTokens={runMetrics.missInputTokens} outputTokens={runMetrics.outputTokens} />
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
        cacheInputTokens={totalTokens.cacheInputTokens}
        missInputTokens={totalTokens.missInputTokens}
        outputTokens={totalTokens.outputTokens}
      />
    </Box>
  );
}

export function startApp(session: Session, persist: () => void): ReturnType<typeof render> {
  return render(<App session={session} persist={persist} />, { exitOnCtrlC: false, incrementalRendering: true });
}
