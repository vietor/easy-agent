import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Box, measureElement, render, useApp, useBoxMetrics, useInput, useWindowSize, type DOMElement } from "ink";
import { type Session, type TimelineEvent } from "@vietor/agent-core";
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
import { anchorAt, scrollDown, scrollUp, visibleWindow, type Anchor } from "./scroll.js";

const LIVE_ITEM = { live: true } as const;

type Item = TimelineEvent | typeof LIVE_ITEM;

export function App({ session, persist }: { session: Session; persist: () => void }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { runMetrics, totalTokens, streaming, thinking, showThinking, setShowThinking, resetMetrics } = useSessionStream(session);
  const allCmds = useMemo(() => slashCommandInfos(session), [session]);
  const pendingQuestion = session.pendingQuestion;
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [, setHeightsTick] = useState(0);
  const regionRef = useRef<DOMElement | null>(null);
  const contentRef = useRef<DOMElement | null>(null);
  const heightsRef = useRef(new WeakMap<Item, number>());
  const { height: regionHeight } = useBoxMetrics(regionRef);
  const { height: contentHeight } = useBoxMetrics(contentRef);

  const live = runMetrics.running && !pendingQuestion;
  const items: readonly Item[] = live ? [...view.timeline, LIVE_ITEM] : view.timeline;
  const heights = items.map((item) => heightsRef.current.get(item));
  const win = visibleWindow(heights, anchor, regionHeight);
  const rendered = items.slice(win.start, win.end + 1);
  const offset = anchor === null ? 0 : Math.max(0, contentHeight - regionHeight - win.viewTop);

  function scrollBy(delta: number): void {
    const from = anchor ?? anchorAt(heights, win.start, Math.max(0, contentHeight - regionHeight));
    setAnchor(delta < 0 ? scrollUp(heights, from, -delta) : scrollDown(heights, from, delta, regionHeight));
  }

  useInput((_input, key) => {
    if (pendingQuestion) {
      if (key.ctrl && _input === "c") session.abort();
      return;
    }
    if (!menuOpen) {
      const page = Math.max(1, regionHeight - 1);
      const delta = key.upArrow ? -1 : key.downArrow ? 1 : key.pageUp ? -page : key.pageDown ? page : 0;
      if (delta !== 0) {
        scrollBy(delta);
        return;
      }
      if (key.home || key.end) {
        setAnchor(key.home ? { index: 0, line: 0 } : null);
        return;
      }
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

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const cache = heightsRef.current;
    let changed = false;
    let i = 0;
    for (const child of node.childNodes) {
      if (child.nodeName !== "ink-box") continue;
      const item = rendered[i];
      i++;
      if (item === undefined) break;
      const height = measureElement(child).height;
      if (cache.get(item) === height) continue;
      cache.set(item, height);
      changed = true;
    }
    if (changed) setHeightsTick((t) => t + 1);
  });

  async function handleCommand(name: string) {
    await executeSlashCommand(name, session, exit, persist);
    if (name === "clear") {
      setAnchor(null);
      resetMetrics();
    }
  }

  async function handlePrompt(text: string) {
    try {
      await session.prompt(text);
      persist();
    } catch (e) {
      session.addError(toErrorMessage(e));
    }
  }

  const liveOutput = (
    <Box flexDirection="column">
      {thinking.text ? <ThinkingView text={thinking.text} expanded={showThinking} /> : null}
      {streaming.text ? (
        <Box marginTop={1}>
          <Markdown>{streaming.text}</Markdown>
        </Box>
      ) : null}
    </Box>
  );

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
        <Box marginTop={1} paddingLeft={1}>
          <Spinner label={spinnerLabel} thinkingElapsed={runMetrics.thinkingElapsed} replyElapsed={runMetrics.replyElapsed} cacheInputTokens={runMetrics.cacheInputTokens} missInputTokens={runMetrics.missInputTokens} outputTokens={runMetrics.outputTokens} />
        </Box>
      );
    }
  }

  return (
    <Box width={columns} height={rows} flexDirection="column">
      <AppHeader cwd={session.cwd} model={session.model} thinkingEffort={session.thinkingEffort} />

      <Box ref={regionRef} flexBasis={0} flexGrow={1} overflow="hidden" flexDirection="column" justifyContent="flex-end">
        <Box ref={contentRef} flexShrink={0} flexDirection="column" paddingLeft={1} paddingRight={1} marginBottom={-offset}>
          {rendered.map((item, i) => (
            <Box key={win.start + i} flexDirection="column">
              {"live" in item ? liveOutput : <TimelineView entry={item} />}
            </Box>
          ))}
        </Box>
      </Box>

      {runningView}

      {view.todos.length > 0 ? <TodoView todos={view.todos} /> : null}

      {!runMetrics.running ? (
        <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} onMenuOpenChange={setMenuOpen} />
      ) : null}

      <StatusBar
        contextTokens={session.contextTokens}
        contextLimit={session.contextLimit}
        running={runMetrics.running}
        questionPending={!!pendingQuestion}
        thinkingAvailable={!!thinking.text}
        scrolled={anchor !== null}
        cacheInputTokens={totalTokens.cacheInputTokens}
        missInputTokens={totalTokens.missInputTokens}
        outputTokens={totalTokens.outputTokens}
      />
    </Box>
  );
}

export function startApp(session: Session, persist: () => void): ReturnType<typeof render> {
  return render(<App session={session} persist={persist} />, { exitOnCtrlC: false, incrementalRendering: true, alternateScreen: true });
}
