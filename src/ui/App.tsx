import { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Agent, AgentEvent } from "../core/agent.js";
import { listCommands, runCommand } from "../core/command.js";
import type { MCPServers } from "../mcp/server.js";
import { getPackageInfo } from "../util/package.js";
import { Markdown } from "./Markdown.js";
import { formatCount, Spinner } from "./Spinner.js";

const pkginfo = getPackageInfo();

type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "system"; text: string };

type Status = "idle" | "thinking" | "streaming";

function preview(isError: boolean, text: string): string {
  if (isError) {
    const previewText = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    return previewText.length > 100 ? previewText.slice(0, 100) + "…" : previewText;
  }

  const lineCount = text.length === 0 ? 0 : (text.match(/\n/g) || []).length + 1;
  const byteCount = new Blob([text]).size;
  return `Result: ${byteCount} bytes, ${lineCount} lines`;
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
            <Text color={entry.isError ? "red" : "gray"}>{`  ${preview(entry.isError ?? false, entry.result)}`}</Text>
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
          <Text color="yellow">◼ interrupted</Text>
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
  const [cmdIdx, setCmdIdx] = useState(-1);
  const cmdSkipRef = useRef(false);
  const allCmds = listCommands();

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

  useInput((_input, key) => {
    if (showCmd) {
      if (key.upArrow) {
        setCmdIdx((i) => (i <= 0 ? filtered.length - 1 : i - 1));
      } else if (key.downArrow) {
        setCmdIdx((i) => (i >= filtered.length - 1 ? 0 : i + 1));
      } else if (key.return && cmdIdx >= 0) {
        cmdSkipRef.current = true;
        const cmd = filtered[cmdIdx];
        setInput("");
        setCmdIdx(-1);
        runCommand(
          cmd.name,
          { agent, mcp },
          {
            exit,
            clearLog: () => setLog([]),
            showSystem: (t) => commit({ kind: "system", text: t }),
            showError: (t) => commit({ kind: "error", text: t }),
            thinking: (on) => setStatus(on ? "thinking" : "idle"),
          },
        );
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

  async function handleSubmit(value: string) {
    if (cmdSkipRef.current) {
      cmdSkipRef.current = false;
      return;
    }
    const text = value.trim();
    setInput("");
    if (!text) return;
    if (text.startsWith("/")) {
      await runCommand(
        text.slice(1),
        { agent, mcp },
        {
          exit,
          clearLog: () => setLog([]),
          showSystem: (t) => commit({ kind: "system", text: t }),
          showError: (t) => commit({ kind: "error", text: t }),
          thinking: (on) => setStatus(on ? "thinking" : "idle"),
        },
      );
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
      </Box>

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

      {status === "idle" ? (
        <>
          {showCmd && cmdIdx >= 0 ? (
            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray">
              {filtered.map((cmd, i) => (
                <Box key={cmd.name}>
                  <Text color={i === cmdIdx ? "cyan" : undefined}>
                    {i === cmdIdx ? "▸ " : "  "}/{cmd.name}
                  </Text>
                  <Text dimColor>  {cmd.description}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
          <Box marginTop={1}>
            <Text dimColor>[{formatCount(agent.contextTokens)} context] · ESC to stop · "/quit" to leave</Text>
          </Box>
          <Box borderStyle="single" borderLeft={false} borderRight={false} borderColor="gray">
            <Text color="gray">❯ </Text>
            <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
          </Box>
        </>
      ) : null}
    </Box>
  );
}

export function startApp(agent: Agent, mcp: MCPServers): ReturnType<typeof render> {
  return render(<App agent={agent} mcp={mcp} />, { exitOnCtrlC: false, patchConsole: true });
}
