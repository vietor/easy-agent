# @vietor/easy-agent-core

> Lightweight AI agent framework — session orchestration, tool system, MCP client/server, skill/command loader.

```bash
npm install @vietor/easy-agent-core
```

Requires Node.js ≥ 22 (ESM only).

---

## `createSession`

**`createSession(options: SessionOptions): Promise<Session>`**

Factory that wires together the LLM client, tool registry, MCP servers, skill-based commands, and custom commands into a ready-to-use `Session` instance.

```ts
import { createSession } from "@vietor/easy-agent-core";

const session = await createSession({
  systemPrompt: "You are a helpful assistant.",
  llmConfig: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your-api-key",
    model: "deepseek-v4-flash",
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
| `llmConfig` | `LLMConfig` | *(required)* | LLM endpoint config (OpenAI-compatible or Anthropic; see `wireApi`). |
| `tools` | `Tool[]` | `undefined` | Additional tools registered alongside built-ins. |
| `commands` | `Command[]` | `undefined` | Custom slash commands. |
| `skills` | `Skill[]` | `undefined` | Skills loaded from SKILL.md files; each registers as a slash command. |
| `mcpServers` | `Record<string, MCPServerConfig>` | `undefined` | MCP servers to connect on startup. |
| `builtinTools` | `BuiltinToolsOptions \| false` | *(all non-interactive)* | Toggle built-in tools; `false` to disable all, or an options object to enable interactive tools. |
| `clientInfo` | `{ name: string; version: string }` | `{ name: "easy-agent-core", version: "0.0.0" }` | Client identity sent to MCP servers. |
| `sessionId` | `string` | `randomUUID()` | Unique session identifier, used as key for persistence. |
| `persistence` | `SessionPersistence` | `undefined` | Persistence backend for save/resume. When set, the session auto-saves after every turn. |
| `compactThreshold` | `number` | `800000` | Estimated-token threshold that triggers auto-compaction of the conversation. |
| `maxTurns` | `number` | `50` | Maximum agent turns (LLM calls with tool calls) per prompt before the run errors out. |
| `stallThreshold` | `number` | `3` | Consecutive identical tool-call sets before the run is treated as stalled. |

---

## `Session`

The main session object. Create one via `createSession()`.

```ts
const session = await createSession({ systemPrompt, llmConfig });
```

### Running prompts

| Method | Description |
|---|---|
| `startPrompt(text: string): Promise<PromptResult>` | Submit a user message and run the agent loop (LLM → tool calls → LLM) until a final answer or error. Returns a `PromptResult` with the run `status` and the final assistant `reply`. |

### Managing conversation

| Method | Description |
|---|---|
| `clear(): void` | Reset the conversation and log. |
| `restore(): Promise<void>` | Reload persisted messages and todos from the `SessionPersistence` backend into the session. |
| `export(): ConversationMessage[]` | Return all conversation messages (excluding the system prompt). |
| `compact(): Promise<RunStatus>` | Ask the LLM to summarize the conversation so far, replacing history with a single summary message. Runs through the run loop — streams the summary and can be aborted via `abort()`. |
| `abort(): void` | Abort the current prompt or compact, cancel pending tool calls, and dismiss unanswered user questions. |
| `submitAnswer(id: string, answer: string): void` | Supply an answer to a pending user question (from the built-in AskUser tool). |
| `getPendingQuestion(): TimelineEntry & { kind: "question" } \| undefined` | Return the first unanswered question, or `undefined` if none are pending. |

### Events

| Method | Description |
|---|---|
| `subscribeEvents(listener: (e: SessionEvent) => void): () => void` | Subscribe to structured incremental events (streaming deltas, tool calls, errors, questions, run state). Supports multiple listeners; returns an unsubscribe function. |
| `flush(): Promise<void>` | Resolve once all pending persistence writes for this session have settled. |

#### `SessionEvent`

A discriminated union emitted as the session runs.

```ts
type SessionEvent =
  | { type: "user"; text: string }
  | { type: "skill"; name: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean }
  | { type: "retry"; attempt: number; max: number }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; text: string; options: string[] }
  | { type: "question_answered"; id: string; answer: string }
  | { type: "system"; text: string }
  | { type: "state"; running: boolean; elapsed: number; inputTokens: number; outputTokens: number };
```

| Type | Emitted when |
|---|---|
| `user` | User submits a prompt (`startPrompt`). |
| `skill` | A skill is invoked. |
| `assistant_delta` | A streaming token delta from the LLM. |
| `assistant` | A text response segment is flushed (on tool call or completion). |
| `tool_start` / `tool_end` | A tool call starts / finishes. |
| `retry` | The LLM client retries after a transient API error. |
| `error` | An error occurred. |
| `interrupted` | The current run was aborted. |
| `question` | The AskUser tool poses a question. |
| `question_answered` | The question is answered (via `submitAnswer` or `abort`). |
| `system` | A command emits a system message, or the run auto-compacts context. |
| `state` | Run state changes: at run start, every second, on usage, and at run end (`running: false`). |

Note: `subscribeEvents` is the primary stream for network/remote consumers (multi-subscriber, incremental). For local React `useSyncExternalStore` view invalidation use `subscribe` + `getSnapshot`.

#### `RunState`

```ts
interface RunState {
  running: boolean;        // whether a prompt is in progress
  elapsed: number;         // seconds since the current prompt started
  inputTokens: number;    // cumulative prompt tokens for the current run
  outputTokens: number; // cumulative completion tokens for the current run
}
```

### Commands

Commands are registered via `createSession()` and invoked as slash commands through the session.

| Method | Description |
|---|---|
| `executeCommand(name: string, args?: string): Promise<void>` | Execute a slash command by name. |
| `commandSchemas: CommandSchema[]` | List all registered command schemas. |

### State accessors

| Property | Type | Description |
|---|---|---|
| `mcpServers` | `readonly MCPServerInfo[]` | Status and tool list of connected MCP servers. |
| `contextTokens` | `number` | Estimated token count of the current conversation. |
| `running` | `boolean` | Whether a prompt/compact is in progress. Check before issuing a driver call (see Reentrancy). |
| `localStore` | `Map<string, unknown>` | A local key-value store available to commands and tools during the session. |

### Reentrancy

A `Session` runs one prompt/compact at a time. While a run is in progress, calling a **driver** method throws `SessionBusyError` (`code === "SESSION_BUSY"`) so a host can map it to an HTTP 409:

| Driver method | Behavior when busy |
|---|---|
| `startPrompt`, `compact`, `executeCommand`, `clear`, `restore` | Throws `SessionBusyError`. |

These remain callable during a run (they are inputs to the running loop, or read-only/teardown):

| Method | Behavior when busy |
|---|---|
| `abort`, `submitAnswer` | Allowed - control the running loop. |
| `subscribeEvents`, `subscribe`, `getSnapshot`, `getPendingQuestion`, `export`, `flush`, `dispose`, accessors | Allowed. |

```ts
import { SessionBusyError } from "@vietor/easy-agent-core";

if (!session.running) {
  try {
    await session.startPrompt(text);
  } catch (e) {
    if (e instanceof SessionBusyError) /* -> HTTP 409 */;
  }
}
```

The `state` event (`running: boolean`) also signals run start/end for stream consumers.

### Snapshot subscription

| Method | Description |
|---|---|
| `subscribe(listener: () => void): () => void` | Subscribe to timeline or todo changes; returns an unsubscribe function. |
| `getSnapshot(): SessionView` | Current session view (`{ timeline, todos }`); the reference stays stable until the next change. Designed for `useSyncExternalStore`. |

### Cleanup

| Method | Description |
|---|---|
| `dispose(): void` | Kill all MCP server processes and clean up. |

---

## Types

### `SessionView`

The snapshot returned by `session.getSnapshot()`.

```ts
interface SessionView {
  timeline: readonly TimelineEntry[];
  todos: readonly Todo[];
}
```

### `PromptResult`

Returned by `session.startPrompt()`.

```ts
interface PromptResult {
  status: RunStatus;
  reply: string;
}
```

`status` indicates how the run ended; `reply` is the final assistant text (may be partial or empty when `status !== "ok"`). Error details are delivered via the `error` event; subscribe to `subscribeEvents` for the full picture.

### `RunStatus`

```ts
type RunStatus = "ok" | "aborted" | "error" | "stalled" | "maxturns";
```

| Status | Meaning |
|---|---|
| `ok` | The run completed with a final assistant reply. |
| `aborted` | The run was aborted via `abort()`. |
| `error` | The run ended due to an LLM/API error. |
| `stalled` | The agent repeated identical tool calls past `stallThreshold`. |
| `maxturns` | The agent exceeded `maxTurns`. |

Also returned by `session.compact()` (`"ok"` on success, `"aborted"` if aborted, `"error"` on failure).

### `TimelineEntry`

A discriminated union representing one entry in the session timeline.

```ts
type TimelineEntry =
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
| `skill` | A skill is invoked. |
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
  baseUrl: string;            // API endpoint (e.g. "https://api.deepseek.com/v1" or "https://api.anthropic.com")
  apiKey: string;             // API key
  model: string;              // Model name (e.g. "deepseek-v4-flash" or "claude-sonnet-5")
  reasoningEffort?: "high" | "max";  // Reasoning depth; defaults to "high". Set "max" for deeper reasoning on complex tasks.
  wireApi?: "completions" | "anthropic";  // Wire protocol; defaults to "completions" (OpenAI Chat Completions). Set "anthropic" to use the Anthropic Messages API via the official SDK.
}
```

`wireApi` selects the request/response protocol the client speaks:

- `"completions"` (default) - OpenAI Chat Completions compatible endpoint. `reasoningEffort` is sent as `reasoning_effort`.
- `"anthropic"` - Anthropic Messages API (via `@anthropic-ai/sdk`). Point `baseUrl` at an Anthropic-compatible endpoint and `model` at a Claude model. `reasoningEffort` enables extended thinking (`"high"` = 16k token budget, `"max"` = 32k); thinking blocks are preserved across tool-use turns as required by the API.

### `SessionPersistence`

Async interface for save/resume. Implement to persist session state between runs (filesystem, database, etc.).

```ts
interface SessionPersistence {
  load(sessionId: string): Promise<SessionState | null>;
  saveAll(sessionId: string, state: SessionState): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  delete?(sessionId: string): Promise<void>;
}
```

`SessionState` is the data persisted per session:

```ts
interface SessionState {
  messages: ConversationMessage[];
  todos: Todo[];
}
```

`SessionMeta` is returned by `listSessions`. Metadata is owned by the implementation: `saveAll` only persists messages and todos, so implementations update `updatedAt` on write and set `createdAt` on first creation without core overwriting a title set elsewhere.

```ts
interface SessionMeta {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
}
```

The `@vietor/easy-agent` CLI includes a filesystem-based implementation (`FileSessionPersistence`) that stores sessions as JSONL files under `~/.easy-agent/projects/`.

Persistence writes are asynchronous and serialized per session: `saveAll` is queued internally so a run never blocks on storage. Call `session.flush()` to await any pending write (e.g. before tearing down a session).

### `Todo`

```ts
interface Todo {
  content: string;
  status: TodoStatus;
}

type TodoStatus = "pending" | "in_progress" | "completed";
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
  cwd: string;                                            // resolved working directory for path-based tools
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
const session = await createSession({
  systemPrompt: "...",
  llmConfig: { ... },
  builtinTools: { askUser: true, todoWrite: true },
});
// or disable all built-in tools:
// builtinTools: false
// or disable specific built-in tools by name (e.g. a read-only agent):
// builtinTools: { disable: ["Shell", "FileWrite", "FileEdit"] }
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

const session = await createSession({
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
| `clear` | Clear the conversation and log. |
| `mcp` | List connected MCP servers with status and tool names. |
| `compact` | Compact the agent context via LLM summarization. |

The raw `Command` objects are exported as `clearCommand`, `mcpCommand`, `compactCommand`, and `builtinCommands` for reuse or extension.

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

const session = await createSession({
  systemPrompt: "...",
  llmConfig: { ... },
  commands: [helloCommand],
});
```

Commands have access to the full `Session` via `ctx.session`, including `.mcpServers`, `.clear()`, `.compact()`, `.localStore`, and `.executeCommand()`.

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

const session = await createSession({
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

### `netFetch`

**`netFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`**

A drop-in replacement for `fetch` that automatically routes through an HTTP(S) proxy when configured. Respects the standard environment variables:

- `HTTPS_PROXY` / `https_proxy` — proxy URL for HTTPS requests (preferred)
- `HTTP_PROXY` / `http_proxy` — proxy URL for HTTP requests (fallback)
- `NO_PROXY` / `no_proxy` — comma-separated hostnames/domains to bypass the proxy

```ts
import { netFetch } from "@vietor/easy-agent-core";

// Same signature as fetch — automatically uses proxy if env vars are set
const res = await netFetch("https://api.example.com/data");
const data = await res.json();
```

---

## Full Quick Start

```ts
import { createSession, tryLoadSkills } from "@vietor/easy-agent-core";

const session = await createSession({
  systemPrompt: "You are a helpful assistant.",
  llmConfig: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your-api-key",
    model: "deepseek-v4-flash",
  },
  mcpServers: {
    filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  },
});

session.subscribeEvents((e) => {
  if (e.type === "assistant_delta") process.stdout.write(e.text);
  else if (e.type === "state")
    console.log(`tokens: ${e.inputTokens} prompt / ${e.outputTokens} completion`);
});

const result = await session.startPrompt("What files are in the current directory?");
console.log(result.reply);                // final assistant reply

console.log(session.getSnapshot().timeline);   // full session timeline
console.log(session.export());     // LLM message history
session.dispose();
```
