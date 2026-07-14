# @vietor/easy-agent-core

> Lightweight AI agent framework — session orchestration, tool system, MCP client/server support, and a skill/command loader.

```bash
npm install @vietor/easy-agent-core
```

Requires Node.js ≥ 22 (ESM only).

---

## `startSession`

**`startSession(options: SessionOptions): Promise<Session>`**

Factory that wires together the LLM client, tool registry, MCP servers, skill-based commands, and custom commands into a ready-to-use `Session` instance.

```ts
import { startSession } from "@vietor/easy-agent-core";

const session = await startSession({
  systemPrompt: "You are a helpful assistant.",
  llmConfig: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o",
  },
  tools: [myCustomTool],
  commands: [myCustomCommand],
  skills: tryLoadSkills("./skills") ?? [],
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  },
  builtinTools: { askUser: true },
  clientInfo: { name: "my-app", version: "1.0.0" },
});
```

### `SessionOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `systemPrompt` | `string` | *(required)* | System prompt for the LLM. |
| `llmConfig` | `LLMConfig` | *(required)* | OpenAI-compatible endpoint config. |
| `tools` | `Tool[]` | `undefined` | Additional tools registered alongside built-ins. |
| `commands` | `Command[]` | `undefined` | Custom slash commands. |
| `skills` | `Skill[]` | `undefined` | Skills loaded from SKILL.md files; each registers as a slash command. |
| `mcpServers` | `Record<string, MCPServerConfig>` | `undefined` | MCP servers to connect on startup. |
| `builtinTools` | `BuiltinToolsOptions \| false` | *(all non-interactive)* | Toggle built-in tools; `false` to disable all, or an options object to enable interactive tools. |
| `clientInfo` | `{ name: string; version: string }` | `{ name: "easy-agent-core", version: "0.0.0" }` | Client identity sent to MCP servers. |

---

## `Session`

The main session object. Create one via `startSession()`.

```ts
const session = await startSession({ systemPrompt, llmConfig });
```

### Running prompts

| Method | Description |
|---|---|
| `startPrompt(text: string): Promise<string>` | Submit a user message and run the agent loop (LLM → tool calls → LLM) until a final answer or error. Returns the final assistant reply text. |

### Managing conversation

| Method | Description |
|---|---|
| `clear(): void` | Reset the conversation and log. |
| `export(): ConversationMessage[]` | Return all conversation messages (excluding the system prompt). |
| `compact(): Promise<boolean>` | Ask the LLM to summarize the conversation so far, replacing history with a single summary message. Returns `false` if aborted. |
| `abort(): void` | Abort the current prompt, cancel pending tool calls, and dismiss unanswered user questions. |
| `submitAnswer(id: string, answer: string): void` | Supply an answer to a pending user question (from the built-in AskUser tool). |

### Callbacks

| Method | Description |
|---|---|
| `setCallbacks(cb: SessionCallbacks): void` | Register streaming and run-state updates. |

#### `SessionCallbacks`

```ts
interface SessionCallbacks {
  onStreaming?: (text: string) => void;
  onRunStateChange?: (state: RunState) => void;
}
```

- `onStreaming` — called on every token delta (the full accumulated text so far). Pass `""` at the end of a flush to reset.
- `onRunStateChange` — called initially, then every second during a run and on usage updates.

#### `RunState`

```ts
interface RunState {
  running: boolean;        // whether a prompt is in progress
  elapsed: number;         // seconds since the current prompt started
  promptTokens: number;    // cumulative prompt tokens for the current run
  completionTokens: number; // cumulative completion tokens for the current run
}
```

### Commands

| Method | Description |
|---|---|
| `executeCommand(name: string, args?: string): Promise<void>` | Execute a slash command by name. |
| `isCommand(name: string): boolean` | Check if a command exists. |
| `commandSchemas: CommandSchema[]` | List all registered command schemas. |

### State accessors

| Property | Type | Description |
|---|---|---|
| `logEntries` | `readonly LogEntry[]` | Full conversation log. |
| `todos` | `readonly Todo[]` | Current task list (from the TodoWrite tool). |
| `mcpServers` | `readonly MCPServerInfo[]` | Status and tool list of connected MCP servers. |
| `contextTokens` | `number` | Estimated token count of the current conversation. |
| `local` | `Map<string, unknown>` | A local key-value store available to commands and tools during the session. |

### Log subscription

| Method | Description |
|---|---|
| `subscribe(listener: () => void): () => void` | Subscribe to log changes; returns an unsubscribe function. |
| `getSnapshot(): number` | Current log version (increments on every append). |

### Cleanup

| Method | Description |
|---|---|
| `dispose(): void` | Kill all MCP server processes and clean up. |

---

## Types

### `LogEntry`

A discriminated union representing one entry in the conversation log.

```ts
type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "question"; id: string; text: string; options: string[]; answer: string | null }
  | { kind: "system"; text: string };
```

| Kind | Emitted when |
|---|---|
| `user` | User submits a prompt (`startPrompt`). |
| `skill` | A skill is invoked (`startSkill`). |
| `assistant` | The LLM finishes a text response (flushed on tool call or completion). |
| `tool` | A tool call starts (`result: null`) or finishes (`result` populated). |
| `retry` | The LLM client retries after a transient API error. |
| `error` | An error occurred (LLM failure, agent stall, etc.). |
| `interrupted` | The current run was aborted. |
| `question` | A question is posed to the user (from AskUser tool). `answer` is `null` until answered. |
| `system` | A system message (e.g. from a command via `ctx.message()`). |

### `ConversationMessage`

The internal message format exchanged with the agent, also returned by `session.export()`.

```ts
type ConversationMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

// AssistantMessage includes optional tool_calls[] for function-calling
```

### `LLMConfig`

```ts
interface LLMConfig {
  baseUrl: string;   // OpenAI-compatible API endpoint (e.g. "https://api.openai.com/v1")
  apiKey: string;    // API key
  model: string;     // Model name (e.g. "gpt-4o", "claude-sonnet-5")
}
```

### `Todo`

```ts
interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}
```

---

## Tool System

### `Tool`

```ts
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema object
  summaryArg?: string | string[];        // parameter key(s) used for display summary
  summarizeArgs?: (args: Record<string, unknown>) => string; // custom summary function
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolResult>;
}
```

- `parameters` is passed to the LLM as a JSON Schema to describe the tool's arguments.
- When the LLM calls a tool, `execute` receives the parsed arguments and a context object.
- Return a plain string (equivalent to `{ content: string }`) or a `ToolResult` with an optional `isError` flag.
- `summaryArg` / `summarizeArgs` control what appears in the tool log entry's `summary` field.

### `ToolContext`

```ts
interface ToolContext {
  signal?: AbortSignal;                                   // abort signal for the current run
  ask(question: string, options: string[]): Promise<string>; // ask the user a question
  setTodos(todos: Todo[]): void;                           // update the task list
}
```

### `ToolResult`

```ts
interface ToolResult {
  content: string;
  isError?: boolean;
}
```

### `ToolSchema`

```ts
interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
```

The format sent to the LLM's `tools` parameter. Generated automatically from registered `Tool` objects.

### Built-in tools

Non-interactive tools (always registered):

| Tool | Description |
|---|---|
| **Shell** | Run shell commands. |
| **FileRead** | Read files with line numbers. |
| **FileWrite** | Create or overwrite files. |
| **FileEdit** | Surgical text replacement. |
| **Glob** | File listing by glob pattern. |
| **Grep** | Content search with regex. |
| **WebFetch** | Fetch URL content. |

Interactive tools (require `builtinTools` option):

| Tool | Option | Description |
|---|---|---|
| **AskUser** | `builtinTools.askUser: true` | Prompt the user for input. |
| **TodoWrite** | `builtinTools.todoWrite: true` | Structured multi-step task tracking. |

```ts
const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  builtinTools: { askUser: true, todoWrite: true },
});
// or disable all built-in tools:
// builtinTools: false
```

### Custom tools example

```ts
import type { Tool } from "@vietor/easy-agent-core";

const greetTool: Tool = {
  name: "greet",
  description: "Greet someone by name",
  parameters: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  async execute(args) {
    return `Hello, ${args.name as string}!`;
  },
};

const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  tools: [greetTool],
});
```

---

## Command System

### `Command`

```ts
interface Command {
  name: string;
  description: string;
  execute(ctx: CommandContext, args: string): Promise<void>;
}
```

- `name` is the slash command name (e.g. `"hello"` → invoked as `/hello`).
- `args` is the raw text typed after the command name.

### `CommandContext`

```ts
interface CommandContext {
  session: Session;
  message(text: string): void;  // append a system log entry
  error(text: string): void;    // append an error log entry
}
```

### `CommandSchema`

```ts
interface CommandSchema {
  name: string;
  description: string;
}
```

### Built-in commands

| Command | Description |
|---|---|
| `/clear` | Clear the conversation and log. |
| `/mcp` | List connected MCP servers with status and tool names. |
| `/compact` | Compact the agent context via LLM summarization. |

### Custom command example

```ts
import type { Command } from "@vietor/easy-agent-core";

const helloCommand: Command = {
  name: "hello",
  description: "Say hello",
  async execute(ctx, args) {
    ctx.message(`Hello, ${args || "world"}!`);
  },
};

const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  commands: [helloCommand],
});
```

Commands have access to the full `Session` via `ctx.session`, including `.mcpServers`, `.clear()`, `.compact()`, `.local`, and `.executeCommand()`.

---

## Skill System

### `Skill`

```ts
interface Skill {
  name: string;
  description?: string;
  prompt: string;
}
```

Skills are loaded from directories containing a `SKILL.md` file and registered as slash commands automatically.

### `tryLoadSkills`

**`tryLoadSkills(path: string): Skill[] | undefined`**

Load skills from a directory. Each subdirectory containing a `SKILL.md` file becomes one skill. Returns `undefined` if the directory doesn't exist or contains no valid skills.

SKILL.md supports front matter:
```markdown
---
name: my-skill
description: Does something useful
---

Your skill prompt here.
```

If no `name` is set in front matter, the directory name is used.

```ts
const skills = tryLoadSkills("./my-skills") ?? [];

const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  skills,
});
```

---

## MCP (Model Context Protocol)

### `MCPServerConfig`

```ts
type MCPServerConfig = StdioServerConfig | RemoteServerConfig;

interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;    // set false to skip this server
}

interface RemoteServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}
```

### `MCPServerInfo`

Returned by `session.mcpServers`.

```ts
interface MCPServerInfo {
  name: string;
  type: "stdio" | "http";
  status: "pending" | "connected" | "failed" | "disabled";
  tools: string[];
}
```

MCP tools are exposed to the LLM with the prefixed name `MCP__<server>__<tool>`. Connection timeout is 30 seconds per server.

---

## Utility Functions

### `tryReadFileText`

**`tryReadFileText(path: string): string | undefined`**

Read a text file, returning `undefined` on any failure (missing file, empty content, read error).

```ts
const content = tryReadFileText("./config.json");
if (content) {
  const config = JSON.parse(content);
}
```

---

## Full Quick Start

```ts
import { startSession, tryLoadSkills } from "@vietor/easy-agent-core";

const session = await startSession({
  systemPrompt: "You are a helpful assistant.",
  llmConfig: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o",
  },
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  },
});

session.setCallbacks({
  onStreaming: (text) => process.stdout.write(text),
  onRunStateChange: (s) =>
    console.log(`tokens: ${s.promptTokens} prompt / ${s.completionTokens} completion`),
});

const reply = await session.startPrompt("What files are in the current directory?");
console.log(reply);                // final assistant reply

console.log(session.logEntries);   // full conversation log
console.log(session.export());     // LLM message history
session.dispose();
```
