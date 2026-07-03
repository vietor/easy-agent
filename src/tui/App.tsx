import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Agent, AgentEvent } from "../core/agent.js";
import { CommandRegistry } from "../cmds/registry.js";
import type { MCPServers } from "../mcp/server.js";
import type { Skill } from "../skills/types.js";
import { Markdown } from "./components/Markdown.js";
import { LogView } from "./LogView.js";
import { LogStore, type LogEntry } from "./LogStore.js";
import { AppHeader } from "./AppHeader.js";
import { PromptOrCommandInput } from "./PromptOrCommandInput.js";
import { Spinner } from "./Spinner.js";
import { compactDisplay } from "../util/format.js";

type Status = "idle" | "thinking" | "streaming";

const STREAM_FRAME_MS = 240;

export function App({ agent, commands, mcp }: { agent: Agent; commands: CommandRegistry, mcp: MCPServers }) {
  const { exit } = useApp();
  const [store] = useState(() => new LogStore());
  const log = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [status, setStatus] = useState<Status>("idle");
  const [, setTick] = useState(0);
  const streamingRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ prompt: 0, completion: 0 });
  const allCmds = useMemo(() => commands.schemas(), []);

  useEffect(() => {
    for (const msg of mcp.flushErrors()) store.append({ kind: "error", text: msg });
    mcp.onError = (msg) => store.append({ kind: "error", text: msg });
    return () => {
      mcp.onError = undefined;
    };
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
      setStatus("streaming");
      setTick((t) => t + 1);
    }, STREAM_FRAME_MS);
  };

  const flushStreaming = () => {
    cancelStreamingRender();
    if (streamingRef.current) {
      store.append({ kind: "assistant", text: streamingRef.current });
      streamingRef.current = "";
    }
  };

  const onEvent = (e: AgentEvent) => {
    if (e.type === "delta") {
      streamingRef.current += e.text;
      scheduleStreamingRender();
    } else if (e.type === "tool_start") {
      flushStreaming();
      setStatus("thinking");
      store.append({ kind: "tool", id: e.id, name: e.name, summary: e.summary, result: null });
    } else if (e.type === "retry") {
      cancelStreamingRender();
      streamingRef.current = "";
      setStatus("thinking");
      store.append({ kind: "retry", attempt: e.attempt, max: e.max });
    } else if (e.type === "tool_end") {
      setStatus("thinking");
      store.setToolResult(e.id, e.result, e.isError);
    } else if (e.type === "error") {
      flushStreaming();
      store.append({ kind: "error", text: e.text });
    } else if (e.type === "interrupted") {
      flushStreaming();
      store.append({ kind: "interrupted" });
    } else if (e.type === "usage") {
      setUsage({ prompt: e.promptTokens, completion: e.completionTokens });
    }
  };

  useInput((_input, key) => {
    if (key.escape) {
      abortRef.current?.abort();
    } else if (key.ctrl && _input === "c") {
      if (abortRef.current) abortRef.current.abort();
      else exit();
    }
  });

  async function handleCommand(name: string) {
    return await commands.execute(name, { agent, mcp }, {
      exit,
      clearLog: () => store.clear(),
      info: (t) => store.append({ kind: "system", text: t }),
      error: (t) => store.append({ kind: "error", text: t }),
      thinking: (on) => setStatus(on ? "thinking" : "idle"),
      runSkill: (s) => handleSkill(s),
    });
  }

  async function runAgent(entry: LogEntry, run: (signal: AbortSignal) => Promise<void>) {
    store.append(entry);
    setStatus("thinking");
    streamingRef.current = "";
    startRef.current = Date.now();
    setElapsed(0);
    setUsage({ prompt: 0, completion: 0 });
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await run(controller.signal);
      flushStreaming();
    } catch (e) {
      flushStreaming();
      store.append({ kind: "error", text: (e as Error).message });
    } finally {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
      abortRef.current = null;
      setStatus("idle");
    }
  }

  async function handlePrompt(text: string) {
    await runAgent({ kind: "user", text }, (signal) => agent.run(text, onEvent, signal));
  }

  async function handleSkill(skill: Skill) {
    await runAgent({ kind: "skill", name: skill.name }, (signal) => agent.runSkill(skill, onEvent, signal));
  }

  return (
    <Box flexDirection="column" minWidth={80}>
      <AppHeader />

      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {log.map((entry, i) => (
          <LogView key={i} entry={entry} />
        ))}
      </Box>

      {status === "streaming" && streamingRef.current ? (
        <Box paddingLeft={1} paddingRight={1}>
          <Markdown color="green">{streamingRef.current}</Markdown>
        </Box>
      ) : null}

      {status === "thinking" ? (
        <Box marginTop={1} paddingLeft={1}>
          <Spinner label="thinking" elapsed={elapsed} promptTokens={usage.prompt} completionTokens={usage.completion} />
        </Box>
      ) : null}

      {status === "idle" ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>[CTX {compactDisplay(agent.contextTokens)}] · ESC to stop · "/quit" to leave</Text>
          <PromptOrCommandInput commands={allCmds} onCommand={handleCommand} onPrompt={handlePrompt} />
        </Box>
      ) : null}
    </Box>
  );
}

export function startApp(agent: Agent, commands: CommandRegistry, mcp: MCPServers): ReturnType<typeof render> {
  process.stdout.write("\u001B[2J\u001B[H");
  return render(<App agent={agent} commands={commands} mcp={mcp} />, { exitOnCtrlC: false });
}
