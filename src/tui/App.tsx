import { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import type { Agent, AgentEvent } from "../core/agent.js";
import { CommandRegistry } from "../cmds/registry.js";
import type { MCPServers } from "../mcp/server.js";
import type { Skill } from "../skills/types.js";
import { Markdown } from "./components/Markdown.js";
import { Entry, type LogEntry } from "./LogView.js";
import { AppHeader } from "./AppHeader.js";
import { PromptOrCommandInput } from "./PromptOrCommandInput.js";
import { Spinner } from "./Spinner.js";
import { compactDisplay } from "../util/format.js";

type Status = "idle" | "thinking" | "streaming";

const STREAM_FRAME_MS = 240;

export function App({ agent, commands, mcp }: { agent: Agent; commands: CommandRegistry, mcp: MCPServers }) {
  const { exit } = useApp();
  const [log, setLog] = useState<LogEntry[]>([]);
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

  const commit = (entry: LogEntry) => setLog((l) => [...l, entry]);

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
      clearLog: () => setLog([]),
      info: (t) => commit({ kind: "system", text: t }),
      error: (t) => commit({ kind: "error", text: t }),
      thinking: (on) => setStatus(on ? "thinking" : "idle"),
      runSkill: (s) => handleSkill(s),
    });
  }

  async function runAgent(entry: LogEntry, run: (signal: AbortSignal) => Promise<void>) {
    commit(entry);
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
      commit({ kind: "error", text: (e as Error).message });
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
          <Entry key={i} entry={entry} />
        ))}
      </Box>

      {status === "streaming" && streamingRef.current ? (
        <Box>
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
