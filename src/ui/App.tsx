import { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import { writeFileSync } from "node:fs";
import TextInput from "ink-text-input";
import type { Agent, AgentEvent } from "../core/agent.js";
import type { MCPServers } from "../mcp/server.js";
import { getPackageInfo } from '../util/package.js';
import { Markdown } from "./Markdown.js";

const pkginfo = getPackageInfo()

type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "system"; text: string };

type Status = "idle" | "thinking" | "streaming";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function formatCount(count: number) {
  if (!count || isNaN(count)) return "0";
  const formatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  return formatter.format(count);
}

function Spinner({ label, elapsed, promptTokens, completionTokens }: { label: string; elapsed: number; promptTokens: number; completionTokens: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Text color="gray">
      {SPINNER_FRAMES[frame]} {label} · {elapsed}s · ↑{formatCount(promptTokens)} · ↓{formatCount(completionTokens)}
    </Text>
  );
}

function preview(s: string): string {
  const line = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return line.length > 100 ? line.slice(0, 100) + "…" : line;
}

function Entry({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <Box marginTop={1}>
          <Text>{`❯ ${entry.text}`}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box paddingLeft={2}>
          <Markdown color="green">{entry.text}</Markdown>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" paddingLeft={2}>
          <Text color="yellow">{`● ${entry.name}${entry.summary ? ` ${entry.summary}` : ""}`}</Text>
          {entry.result !== null ? (
            <Text color={entry.isError ? "red" : "gray"}>{`  ${preview(entry.result)}`}</Text>
          ) : null}
        </Box>
      );
    case "retry":
      return (
        <Box paddingLeft={2}>
          <Text color="yellow">{`↻ Retry ${entry.attempt}/${entry.max}`}</Text>
        </Box>
      );
    case "error":
      return (
        <Box>
          <Text color="red">{`✗ ${entry.text}`}</Text>
        </Box>
      );
    case "interrupted":
      return (
        <Box paddingLeft={2}>
          <Text color="yellow">⏹ interrupted</Text>
        </Box>
      );
    case "system":
      return (
        <Box paddingLeft={2}>
          <Text color="gray">{entry.text}</Text>
        </Box>
      );
  }
}

export function App({ agent, mcp }: { agent: Agent; mcp: MCPServers }) {
  const { exit } = useApp();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [, setTick] = useState(0);
  const streamingRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState({ prompt: 0, completion: 0 });

  const commit = (entry: LogEntry) => setLog((l) => [...l, entry]);

  useEffect(() => {
    for (const msg of mcp.flushErrors()) commit({ kind: "error", text: msg });
    mcp.onError = (msg) => commit({ kind: "error", text: msg });
    return () => {
      mcp.onError = undefined;
    };
  }, []);
  const flushStreaming = () => {
    if (streamingRef.current) {
      commit({ kind: "assistant", text: streamingRef.current });
      streamingRef.current = "";
    }
  };

  const onEvent = (e: AgentEvent) => {
    if (e.type === "delta") {
      streamingRef.current += e.text;
      setStatus("streaming");
      setTick((t) => t + 1);
    } else if (e.type === "tool_start") {
      flushStreaming();
      setStatus("thinking");
      commit({ kind: "tool", name: e.name, summary: e.summary, result: null });
    } else if (e.type === "retry") {
      streamingRef.current = "";
      setStatus("thinking");
      commit({ kind: "retry", attempt: e.attempt, max: e.max });
    } else if (e.type === "tool_end") {
      setStatus("thinking");
      setLog((l) => {
        const copy = [...l];
        for (let i = copy.length - 1; i >= 0; i--) {
          const entry = copy[i];
          if (entry.kind === "tool" && entry.result === null) {
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

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) {
      if (abortRef.current) abortRef.current.abort();
      else if (key.ctrl && input === "c") exit();
    }
  });

  async function handleSubmit(value: string) {
    const text = value.trim();
    setInput("");
    if (!text) return;
    if (text.startsWith("/")) {
      const command = text.slice(1);
      if (command === "exit" || command === "quit") {
        exit();
        return;
      }
      if (command === "clear") {
        agent.clear();
        setLog([]);
        return;
      }
      if (command === "mcp") {
        const servers = mcp.list();
        const text = servers.length
          ? ["MCP servers:", ...servers.map((s) => `❯ ${s.name} ⋅ ${s.status} ∶ ${s.tools.join(", ") || "(no tools)"}`)].join("\n")
          : "No MCP servers linked.";
        commit({ kind: "system", text });
        return;
      }
      if (command === "compact") {
        setStatus("thinking");
        try {
          await agent.compact();
          commit({ kind: "system", text: "context compacted" });
        } catch (e) {
          commit({ kind: "error", text: (e as Error).message });
        } finally {
          setStatus("idle");
        }
        return;
      }
      if (command === "export") {
        try {
          const d = new Date();
          const pad = (n: number) => String(n).padStart(2, "0");
          const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
          const file = `session-${ts}.jsonl`;
          const lines = agent.export().map((m) => JSON.stringify(m)).join("\n");
          writeFileSync(file, lines + "\n", "utf-8");
          commit({ kind: "system", text: `exported to ${file}` });
        } catch (e) {
          commit({ kind: "error", text: (e as Error).message });
        }
        return;
      }
      commit({ kind: "error", text: `unknown command: ${text}` });
      return;
    }
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
      <Box flexDirection="column">
        <Box>
          <Text color="red" bold>Easy Agent</Text>
          <Text dimColor> v{pkginfo.version}</Text>
        </Box>
        <Text dimColor>{process.cwd()}</Text>
        <Text dimColor>ready · {formatCount(agent.contextTokens)} tokens · esc to stop · “/quit” to leave</Text>
      </Box>

      {log.map((entry, i) => (
        <Entry key={i} entry={entry} />
      ))}

      {status === "streaming" && streamingRef.current ? (
        <Box paddingLeft={2}>
          <Markdown color="green">{streamingRef.current}</Markdown>
        </Box>
      ) : null}

      {status === "thinking" ? <Spinner label="thinking" elapsed={elapsed} promptTokens={usage.prompt} completionTokens={usage.completion} /> : null}

      {status === "idle" ? (
        <Box marginTop={1} borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray">
          <Text color="gray">❯ </Text>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
        </Box>
      ) : null}
    </Box>
  );
}

export function startApp(agent: Agent, mcp: MCPServers): void {
  render(<App agent={agent} mcp={mcp} />, { exitOnCtrlC: false });
}
