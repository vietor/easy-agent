import { useEffect, useRef, useState } from "react";
import { Box, render, Text, useApp } from "ink";
import TextInput from "ink-text-input";
import type { Agent, AgentEvent } from "../core/agent.js";
import type { MCPServers } from "../mcp/server.js";

type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; summary: string; result: string | null }
  | { kind: "error"; text: string }
  | { kind: "system"; text: string };

type Status = "idle" | "thinking" | "streaming";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function Spinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return (
    <Text color="gray">
      {SPINNER_FRAMES[frame]} {label}
    </Text>
  );
}

function preview(s: string): string {
  const line = s.split("\n")[0].trim();
  return line.length > 100 ? line.slice(0, 100) + "…" : line;
}

function Entry({ entry }: { entry: LogEntry }) {
  switch (entry.kind) {
    case "user":
      return <Text color="cyan">{`❯ ${entry.text}`}</Text>;
    case "assistant":
      return (
        <Box paddingLeft={2}>
          <Text color="green">{entry.text}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column">
          <Text color="yellow">{`  ● ${entry.name}${entry.summary ? ` ${entry.summary}` : ""}${entry.result === null ? " …" : ""}`}</Text>
          {entry.result !== null && preview(entry.result) ? (
            <Text color="gray">{`    ${preview(entry.result)}`}</Text>
          ) : null}
        </Box>
      );
    case "error":
      return <Text color="red">{`✗ ${entry.text}`}</Text>;
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
    } else if (e.type === "tool_end") {
      setStatus("thinking");
      setLog((l) => {
        const copy = [...l];
        for (let i = copy.length - 1; i >= 0; i--) {
          const entry = copy[i];
          if (entry.kind === "tool" && entry.result === null) {
            copy[i] = { ...entry, result: e.result };
            break;
          }
        }
        return copy;
      });
    }
  };

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
      commit({ kind: "error", text: `unknown command: ${text}` });
      return;
    }
    commit({ kind: "user", text });
    setStatus("thinking");
    streamingRef.current = "";
    try {
      await agent.run(text, onEvent);
      flushStreaming();
    } catch (e) {
      flushStreaming();
      commit({ kind: "error", text: (e as Error).message });
    } finally {
      setStatus("idle");
    }
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray" marginBottom={1}>
        <Text color="cyan" bold>
          Easy Agent
        </Text>
        <Text dimColor> ready · type “/quit” to leave</Text>
      </Box>

      {log.map((entry, i) => (
        <Entry key={i} entry={entry} />
      ))}

      {status === "streaming" && streamingRef.current ? (
        <Box paddingLeft={2}>
          <Text color="green">{streamingRef.current}</Text>
        </Box>
      ) : null}

      {status === "thinking" ? <Spinner label="thinking" /> : null}

      {status === "idle" ? (
        <Box marginTop={1}>
          <Text color="cyan">❯ </Text>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
        </Box>
      ) : null}
    </Box>
  );
}

export function startApp(agent: Agent, mcp: MCPServers): void {
  render(<App agent={agent} mcp={mcp} />);
}
