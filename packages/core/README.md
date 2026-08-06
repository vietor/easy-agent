# @vietor/easy-agent-core

> Lightweight AI agent framework — session orchestration, tool system, MCP client/server, skill loader.

```bash
npm install @vietor/easy-agent-core
```

Requires Node.js ≥ 22 (ESM only).

---

## `createSession`

**`createSession(options: SessionOptions): Promise<Session>`**

Factory that wires together the LLM client, tool registry, MCP servers, and skills into a ready-to-use `Session` instance.

```ts
import { createSession } from "@vietor/easy-agent-core";

const session = await createSession({
  systemPrompt: "You are a helpful assistant.",
  llmConfig: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your-api-key",
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    wireApi: "completions",
    maxInputTokens: 1_000_000,
  },
  tools: [myCustomTool],
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
| `llmConfig` | `LLMConfig` | *(required)* | LLM endpoint config (OpenAI-compatible or Anthropic; see `wireApi`). Only `baseUrl`, `apiKey`, and `model` are required; `reasoningEffort`, `wireApi`, `maxInputTokens`, and `maxOutputTokens` default to `"high"`, `"completions"`, `1_000_000`, and `128_000`. |
| `cwd` | `string` | `process.cwd()` | Working directory used by tools (e.g. path-based tools). |
| `tools` | `Tool[]` | `undefined` | Additional tools registered alongside built-ins. |
| `skills` | `Skill[]` | `undefined` | Skills loaded from SKILL.md files; invoked via the built-in Skill tool or via `session.runSkill()` (hosts may map them to slash commands). |
| `mcpServers` | `Record<string, MCPServerConfig>` | `undefined` | MCP servers to connect on startup. |
| `builtinTools` | `BuiltinToolsOptions \| false` | *(7 core tools enabled; interactive tools off)* | `readOnly: true` registers only the read-only core tools (FileRead/Glob/Grep/WebFetch); `askUser`/`todoWrite`/`subAgent` enable interactive tools (all off by default); `false` to disable all built-in tools. |
| `clientInfo` | `{ name: string; version: string }` | `{ name: "easy-agent-core", version: "0.0.0" }` | Client identity sent to MCP servers. |
| `sessionId` | `string` | `randomUUID()` | Unique session identifier, used as key for persistence. |
| `persistence` | `SessionPersistence` | `undefined` | Persistence backend for save/resume. When set, the session auto-saves after every turn. |
| `maxTurns` | `number` | `50` | Maximum agent turns (LLM calls with tool calls) per prompt before the run errors out. |
| `stallThreshold` | `number` | `3` | Stall tolerance: consecutive identical tool-call sets, or consecutive text-only responses while todos are incomplete, before the run is treated as stalled. |

The auto-compaction threshold is not configurable — it's derived internally as 75% of `llmConfig.maxInputTokens` and exposed via `session.compactThreshold`.

---

## `SYSTEM_PROMPT_BOUNDARY`

**`SYSTEM_PROMPT_BOUNDARY: string`**

A constant separator that `createSession` appends between the user-provided `systemPrompt` and the auto-generated tool-use/behavior guidelines. Also exported so callers can use it when composing their own system prompt from multiple segments:

```ts
import { SYSTEM_PROMPT_BOUNDARY } from "@vietor/easy-agent-core";

const systemPrompt = [
  coreInstructions,
  contextRules,
].join(SYSTEM_PROMPT_BOUNDARY);
```

---

## `Session`

The main session object. Create one via `createSession()` — it wires the LLM client, tool registry, and MCP servers, and connects MCP servers listed in `mcpServers`:

```ts
const session = await createSession({ systemPrompt, llmConfig });
```

### Running prompts

| Method | Description |
|---|---|
| `startPrompt(text: string): Promise<SessionPromptResult>` | Submit a user message and run the agent loop (LLM → tool calls → LLM) until a final answer or error. Returns a `SessionPromptResult` with the run `status` and the final assistant `reply`. |

### Managing conversation

| Method | Description |
|---|---|
| `clear(): void` | Reset the conversation and log. |
| `restore(): Promise<boolean>` | Reload persisted messages and todos from the `SessionPersistence` backend into the session. Returns `false` (loading nothing) when the backend has no saved state for this session. |
| `export(): ConversationMessage[]` | Return all conversation messages (excluding the system prompt). |
| `compact(): Promise<AgentRunStatus>` | Ask the LLM to summarize the conversation so far, replacing history with a single summary message. Runs through the run loop — streams the summary and can be aborted via `abort()`. |
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
  | { type: "reasoning_delta"; text: string }
  | { type: "reasoning_clear" }
  | { type: "assistant"; text: string }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; preview?: string }
  | { type: "retry"; attempt: number; max: number; reason: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; text: string; options: string[] }
  | { type: "question_answered"; id: string; answer: string }
  | { type: "notice"; text: string }
  | { type: "state"; running: boolean; elapsed: number; thinkingElapsed: number; replyElapsed: number; inputTokens: number; outputTokens: number };
```

| Type | Emitted when |
|---|---|
| `user` | User submits a prompt (`startPrompt`). |
| `skill` | A skill is invoked. |
| `assistant_delta` | A streaming token delta from the LLM. |
| `reasoning_delta` | A streaming thinking/reasoning token delta (extended thinking). |
| `reasoning_clear` | Clears the accumulated reasoning text (e.g. on new tool round). |
| `assistant` | A text response segment is flushed (on tool call or completion). |
| `tool_start` / `tool_end` | A tool call starts / finishes. |
| `retry` | The LLM client retries after a transient API error. |
| `error` | An error occurred. |
| `interrupted` | The current run was aborted. |
| `question` | The AskUser tool poses a question. |
| `question_answered` | The question is answered (via `submitAnswer` or `abort`). |
| `notice` | `session.timelineNotice()` is called, or the run auto-compacts context. |
| `state` | Run state changes: at run start, every second, on usage, and at run end (`running: false`). |

Note: `subscribeEvents` is the primary stream for network/remote consumers (multi-subscriber, incremental). For local React `useSyncExternalStore` view invalidation use `subscribe` + `getSnapshot`.

#### `SessionRunState`

```ts
interface SessionRunState {
  running: boolean;        // whether a prompt is in progress
  elapsed: number;         // seconds since the current prompt started
  thinkingElapsed: number; // seconds before the first assistant text token (incl. reasoning/tools)
  replyElapsed: number;    // seconds after the first assistant text token (incl. later tool rounds)
  inputTokens: number;     // cumulative input (prompt) tokens for the current run
  outputTokens: number;    // cumulative output (completion) tokens for the current run
}
```

`createSessionRunState(): SessionRunState` returns the all-zero, not-running initial value.

### Skills & messages

The command system lives in host code. Core exposes the primitives hosts build on:

| Method | Description |
|---|---|
| `runSkill(name: string): Promise<boolean>` | Run a skill by name through the agent loop. Returns `false` (no error emitted) if the name is unknown; throws `SessionBusyError` if a run is in progress. |
| `timelineNotice(text: string): void` | Append a notice entry to the timeline and emit a `notice` event. |
| `timelineError(text: string): void` | Append an error entry to the timeline and emit an `error` event. |
| `skills: readonly Skill[]` | All loaded skills. |

### State accessors

| Property | Type | Description |
|---|---|---|
| `model` | `string` | The LLM model name (e.g. `"deepseek-v4-flash"`). |
| `reasoningEffort` | `"high" \| "max"` | The configured reasoning effort. |
| `compactThreshold` | `number` | Estimated-token threshold that triggers auto-compaction. |
| `mcpServers` | `readonly MCPServerInfo[]` | Status and tool list of connected MCP servers. |
| `contextTokens` | `number` | Estimated token count of the current conversation. |
| `running` | `boolean` | Whether a prompt/compact is in progress. Check before issuing a driver call (see Reentrancy). |
| `localStore` | `Map<string, unknown>` | A local key-value store available to tools and host code during the session. |

### Reentrancy

A `Session` runs one prompt/compact at a time. While a run is in progress, calling a **driver** method throws `SessionBusyError` (`code === "SESSION_BUSY"`) so a host can map it to an HTTP 409:

| Driver method | Behavior when busy |
|---|---|
| `startPrompt`, `compact`, `runSkill`, `clear`, `restore` | Throws `SessionBusyError`. |

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
| `getSnapshot(): SessionSnapshot` | Current session snapshot (`{ timeline, todos }`); the reference stays stable until the next change. Designed for `useSyncExternalStore`. |

### Cleanup

| Method | Description |
|---|---|
| `dispose(): void` | Kill all MCP server processes and clean up. |

---

## Types

### `SessionSnapshot`

The snapshot returned by `session.getSnapshot()`.

```ts
interface SessionSnapshot {
  timeline: readonly TimelineEntry[];
  todos: readonly Todo[];
}
```

### `SessionPromptResult`

Returned by `session.startPrompt()`.

```ts
interface SessionPromptResult {
  status: AgentRunStatus;
  reply: string;
}
```

`status` indicates how the run ended; `reply` is the final assistant text (may be partial or empty when `status !== "ok"`). Error details are delivered via the `error` event; subscribe to `subscribeEvents` for the full picture.

### `AgentRunStatus`

```ts
type AgentRunStatus = "ok" | "aborted" | "error" | "stalled" | "max_turns";
```

| Status | Meaning |
|---|---|
| `ok` | The run completed with a final assistant reply. |
| `aborted` | The run was aborted via `abort()`. |
| `error` | The run ended due to an LLM/API error. |
| `stalled` | The agent stalled past `stallThreshold`: repeated identical tool calls, or repeated text-only responses while todos are incomplete. |
| `max_turns` | The agent exceeded `maxTurns`. |

Also returned by `session.compact()` (`"ok"` on success, `"aborted"` if aborted, `"error"` on failure).

### `TimelineEntry`

A discriminated union representing one entry in the session timeline.

```ts
type TimelineEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean; preview?: string }
  | { kind: "retry"; attempt: number; max: number; reason: string }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "question"; id: string; text: string; options: string[]; answer: string | null }
  | { kind: "notice"; text: string };
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
| `notice` | A notice (from `session.timelineNotice()`). |

### `ConversationMessage`

The internal message format exchanged with the agent, also returned by `session.export()`.

```ts
type ConversationMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string; preview?: string; isError?: boolean };

// AssistantMessage includes optional tool_calls[] for function-calling
```

### `LLMConfig`

```ts
interface LLMConfig {
  baseUrl: string;            // API endpoint (e.g. "https://api.deepseek.com/v1" or "https://api.anthropic.com") — required
  apiKey: string;             // API key — required
  model: string;              // Model name (e.g. "deepseek-v4-flash" or "claude-sonnet-5") — required
  reasoningEffort?: "high" | "max";  // Reasoning depth; "high" for standard tasks, "max" for deeper reasoning on complex tasks (default: "high")
  wireApi?: "completions" | "anthropic";  // Wire protocol; "completions" (OpenAI Chat Completions) or "anthropic" (Anthropic Messages API via the official SDK) (default: "completions")
  maxInputTokens?: number;    // Context window in tokens; 75% of it is used as the auto-compaction threshold (default: 1,000,000)
  maxOutputTokens?: number;   // Max output tokens per request, capped by the model's output limit (default: 128,000)
}
```

`wireApi` selects the request/response protocol the client speaks:

- `"completions"` - OpenAI Chat Completions compatible endpoint. `reasoningEffort` is sent as `reasoning_effort`.
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
  readOnly?: boolean;
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema object
  summaryArg?: string | string[];        // parameter key(s) used for display summary
  summarizeArgs?: (args: Record<string, unknown>) => string; // custom summary function
  getPreview?(result: ToolResult): string; // result preview for timeline display
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolResult>;
}
```

- `readOnly` (optional) marks the tool as read-only. Read-only tools are what `builtinTools: { readOnly: true }` registers, and what the SubAgent tool equips sub-agents with.
- `parameters` is passed to the LLM as a JSON Schema to describe the tool's arguments.
- When the LLM calls a tool, `execute` receives the parsed arguments and a context object.
- Return a plain string (equivalent to `{ content: string }`) or a `ToolResult` with an optional `isError` flag.
- `summaryArg` / `summarizeArgs` control what appears in the tool log entry's `summary` field.
- `getPreview` (optional) returns a short result preview for timeline display. Called after execution with the result; the registry prefixes the wall-clock duration. Falls back to a default preview (byte/line count) when not defined.

### `ToolContext`

```ts
interface ToolContext {
  signal?: AbortSignal;  // abort signal for the current run
  cwd: string;           // resolved working directory for path-based tools
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

Core tools (registered by default; `builtinTools: { readOnly: true }` registers only the read-only subset):

| Tool | Description |
|---|---|
| **FileRead** *(read-only)* | Read files with line numbers. |
| **Glob** *(read-only)* | File listing by glob pattern. |
| **Grep** *(read-only)* | Content search with regex. |
| **WebFetch** *(read-only)* | General-purpose HTTP GET — converts HTML to markdown, returns JSON/XML/text raw. Retries transient failures (network, timeouts, 408/429/5xx) up to 3 attempts. |
| **Shell** | Run shell commands. |
| **FileWrite** | Create or overwrite files. |
| **FileEdit** | Surgical text replacement. |

Interactive tools are **off by default** and registered only when explicitly enabled via `builtinTools` (`askUser: true`, `todoWrite: true`, `subAgent: true`):

| Tool | Description |
|---|---|
| **AskUser** | Ask the user a question and wait for the answer. |
| **TodoWrite** | Track multi-step task progress; the agent must complete every task before its final reply. |
| **Skill** | Invoke a skill by name; loads its instructions into context. Registered automatically whenever `skills` are provided. |
| **SubAgent** | Run a nested sub-agent: read-only "explore" investigation or "plan" implementation planning. Sub-agents are equipped with the session's read-only tools (FileRead/Glob/Grep/WebFetch, plus any custom tools marked `readOnly`). |

`builtinTools: false` disables all built-in tools.

```ts
const session = await createSession({
  systemPrompt: "...",
  llmConfig: { ... },
  builtinTools: { askUser: true, todoWrite: true },
});
// Disable all built-in tools:
// builtinTools: false
// Read-only session (no Shell / FileWrite / FileEdit):
// builtinTools: { readOnly: true }
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

Slash commands are a **host-side (UI) concept** — the core package no longer ships a command system. Hosts implement their own dispatcher on top of the session primitives: `startPrompt()`, `runSkill()`, `timelineNotice()`, `timelineError()`, and the `skills` getter.

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

Skills are loaded from directories containing a `SKILL.md` file. They are listed in the system prompt so the agent can invoke them via the built-in **Skill** tool, and can also be run directly by hosts via `session.runSkill(name)` (e.g. mapped to slash commands).

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
  error?: string;  // connection error message when status is "failed"
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

### `htmlToMarkdown`

**`htmlToMarkdown(html: string): string`**

Convert HTML to Markdown using [Turndown](https://github.com/mixmark-io/turndown). Strips script, style, title, meta, head, noscript, template, link, and base elements.

```ts
import { htmlToMarkdown } from "@vietor/easy-agent-core";

const md = htmlToMarkdown("<h1>Hello</h1><p>World</p>");
// "# Hello\n\nWorld"
```

### `getTextBytes`

**`getTextBytes(content: string): number`**

Return the UTF-8 byte length of a string (via `Buffer.byteLength`).

```ts
import { getTextBytes } from "@vietor/easy-agent-core";

const bytes = getTextBytes("Hello");   // 5
```

### `timeFormat`

**`timeFormat(value: number): string`**

Format a duration in seconds for display (e.g. `3.2s`). Used for tool-result previews.

```ts
import { timeFormat } from "@vietor/easy-agent-core";

timeFormat(3.24);   // "3.24s"
```

### `compactFormat`

**`compactFormat(value: number): string`**

Format a number compactly (e.g. `1.2K`). Used for byte/line counts in previews.

```ts
import { compactFormat } from "@vietor/easy-agent-core";

compactFormat(1234);   // "1.23K"
```

### `ellipsisText`

**`ellipsisText(content: string, length: number): string`**

Collapse whitespace and truncate text to `length` characters with a trailing `…`.

```ts
import { ellipsisText } from "@vietor/easy-agent-core";

ellipsisText("a\nvery   long line", 8);   // "a very l…"
```

### `errorMessage`

**`errorMessage(e: unknown): string`**

Stringify an unknown error for display (`e instanceof Error ? e.message : String(e)`). Used across core for error events.

```ts
import { errorMessage } from "@vietor/easy-agent-core";

errorMessage(new Error("boom"));   // "boom"
errorMessage("oops");              // "oops"
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
    reasoningEffort: "high",
    wireApi: "completions",
    maxInputTokens: 1_000_000,
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
