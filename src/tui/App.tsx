import { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Agent, AgentEvent } from "../core/agent.js";
import { listCommands, runCommand } from "../core/command.js";
import type { MCPServers } from "../mcp/server.js";
import { Markdown } from "./components/Markdown.js";
import { Entry, type LogEntry } from "./LogView.js";
import { AppHeader } from "./AppHeader.js";
import { CommandMenu } from "./CommandMenu.js";
import { PromptInput } from "./PromptInput.js";
import { Spinner } from "./Spinner.js";
import { compactDisplay } from "../util/format.js";

type Status = "idle" | "thinking" | "streaming";

const STREAM_FRAME_MS = 240;

export function App({ agent, mcp }: { agent: Agent; mcp: MCPServers }) {
  const { exit } = useApp();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [, setTick] = useState(0);
  const streamingRef = useRef("");
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ prompt: 0, completion: 0 });
  const [cmdIdx, setCmdIdx] = useState(-1);
  const allCmds = useMemo(() => listCommands(), []);

  const commit = (entry: LogEntry) => setLog((l) => [...l, entry]);

  const cmdPrefix = status === "idle" && input.startsWith("/") ? input.slice(1) : null;
  const filtered = cmdPrefix === null ? [] : cmdPrefix === "" ? allCmds : allCmds.filter((c) => c.name.startsWith(cmdPrefix));
  const showCmd = cmdPrefix !== null && filtered.length > 0;

  useEffect(() => {
    if (filtered.length > 0 && cmdIdx === -1) setCmdIdx(0);
    else if (cmdIdx >= filtered.length) setCmdIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length]);

  useEffect(() => {
    for (const msg of mcp.flushErrors()) commit({ kind: "error", text: msg });
    mcp.onError = (msg) => commit({ kind: "error", text: msg });
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
      commit({ kind: "assistant", text: streamingRef.current });
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
      commit({ kind: "tool", id: e.id, name: e.name, summary: e.summary, result: null });
    } else if (e.type === "retry") {
      cancelStreamingRender();
      streamingRef.current = "";
      setStatus("thinking");
      commit({ kind: "retry", attempt: e.attempt, max: e.max });
    } else if (e.type === "tool_end") {
      setStatus("thinking");
      setLog((l) => {
        const copy = [...l];
        for (let i = copy.length - 1; i >= 0; i--) {
          const entry = copy[i];
          if (entry.kind === "tool" && entry.id === e.id && entry.result === null) {
            copy[i] = { ...entry, result: e.result, isError: e.isError };
            break;
          }
        }
        return copy;
      });
    } else if (e.type === "error") {
      flushStreaming();
      commit({ kind: "error", text: e.text });
    } else if (e.type === "interrupted") {
      flushStreaming();
      commit({ kind: "interrupted" });
    } else if (e.type === "usage") {
      setUsage({ prompt: e.promptTokens, completion: e.completionTokens });
    }
  };

  useInput((_input, key) => {
    if (showCmd) {
      if (key.upArrow) {
        setCmdIdx((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      } else if (key.downArrow) {
        setCmdIdx((i) => (i >= filtered.length - 1 ? 0 : i + 1));
      } else if (key.escape) {
        setInput("");
        setCmdIdx(-1);
      } else if (key.ctrl && _input === "c") {
        exit();
      }
      return;
    }
    if (key.escape || (key.ctrl && _input === "c")) {
      if (abortRef.current) abortRef.current.abort();
      else if (key.ctrl && _input === "c") exit();
    }
  });

  async function handleCommand(command: string) {
    const cmdName = showCmd && cmdIdx >= 0 ? filtered[cmdIdx].name : command;
    setCmdIdx(-1);
    await runCommand(
      cmdName,
      { agent, mcp },
      {
        exit,
        clearLog: () => setLog([]),
        showSystem: (t) => commit({ kind: "system", text: t }),
        showError: (t) => commit({ kind: "error", text: t }),
        thinking: (on) => setStatus(on ? "thinking" : "idle"),
      },
    );
  }

  async function handlePrompt(text: string) {
    commit({ kind: "user", text });
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
      await agent.run(text, onEvent, controller.signal);
      flushStreaming();
    } catch (e) {
      flushStreaming();
      commit({ kind: "error", text: (e as Error).message });
    } finally {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
      abortRef.current = null;
      setStatus("idle");
    }
  }

  return (
    <Box flexDirection="column">
      <AppHeader />

      {log.map((entry, i) => (
        <Entry key={i} entry={entry} />
      ))}

      {status === "streaming" && streamingRef.current ? (
        <Box paddingLeft={2}>
          <Markdown color="green">{streamingRef.current}</Markdown>
        </Box>
      ) : null}

      {status === "thinking" ? (
        <Spinner label="thinking" elapsed={elapsed} promptTokens={usage.prompt} completionTokens={usage.completion} />
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>[CTX {compactDisplay(agent.contextTokens)}] · ESC to stop · "/quit" to leave</Text>
      </Box>
      {status === "idle" ? (
        <Box flexDirection="column">
          <CommandMenu show={showCmd} selectedIndex={cmdIdx} commands={filtered} />
          <PromptInput input={input} setInput={setInput} onCommand={handleCommand} onPrompt={handlePrompt} />
        </Box>
      ) : null}
    </Box>
  );
}

export function startApp(agent: Agent, mcp: MCPServers): ReturnType<typeof render> {
  return render(<App agent={agent} mcp={mcp} />, { exitOnCtrlC: false, patchConsole: true });
}
