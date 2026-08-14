# @vietor/agent-core

> Lightweight AI agent framework — session orchestration, tool system, MCP client/server, skill loader.

```bash
npm install @vietor/agent-core
```

Requires Node.js ≥ 22 (ESM only).

## Breaking changes (0.8)

- `StreamEvent` and `TimelineEvent` merged into a single `AgentEvent` union; every variant now carries a `persisted: true/false` flag. Streaming tags are camelCase: `assistantDelta`, `thinkingDelta`, `thinkingClear`, `toolStart`, `toolEnd`, `runMetrics`.
- `ConversationMessage` → `SessionMessage`; `Conversation` (internal) → `SessionMessages`.
- `SessionOptions.mcp` → `SessionOptions.mcpServers` (the runtime getter `session.mcpServers` is unchanged).
- `ClientInfo` → `MCPClientInfo`; internal `MCPServers` → `MCPServerManager`.
- `BuiltInToolsOptions` → `BuiltinToolsOptions`.
- Generic helpers (`tryReadFileText`, `htmlToMarkdown`, `getTextBytes`, `formatSeconds`, `formatCompactNumber`, `truncateText`, `toErrorMessage`, `MAX_SUMMARY_LENGTH`, `netFetch`, `runProcess`, `ProcessResult`) moved from the root export to `@vietor/agent-core/util`.
- Tool-result summaries count non-empty lines (previously every newline).

---

## `createSession`

**`createSession(options: SessionOptions): Promise<Session>`**

Factory that wires together the LLM client, tool registry, MCP servers, and skills into a ready-to-use `Session` instance.

```ts
import { createSession } from "@vietor/agent-core";

const session = await createSession({
  systemPrompt: "You are a helpful assistant.",
  llm: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your-api-key",
    model: "deepseek-v4-flash",
    thinkingEffort: "high",
    backend: "completions",
    maxInputTokens: 1_000_000,
  },
  tools: [myCustomTool],
  skills: tryLoadSkills("./skills") ?? [],
  mcpServers: {
    filesystem: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  },
  builtInTools: { askUser: true },
  clientInfo: { name: "my-app", version: "1.0.0" },
});
```

### `SessionOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `systemPrompt` | `string` | *(required)* | System prompt for the LLM. |
| `llm` | `LLMConfig` | *(required)* | LLM endpoint config (OpenAI-compatible or Anthropic; see `backend`). Only `baseUrl`, `apiKey`, and `model` are required; `thinkingEffort`, `backend`, `maxInputTokens`, and `maxOutputTokens` default to `"high"`, `"completions"`, `1_000_000`, and `128_000`. |
| `cwd` | `string` | `process.cwd()` | Working directory used by tools (e.g. path-based tools). |
| `tools` | `Tool[]` | `undefined` | Additional tools registered alongside built-ins. |
| `skills` | `Skill[]` | `undefined` | Skills loaded from SKILL.md files; invoked via the built-in Skill tool or via `session.runSkill()` (hosts may map them to slash commands). |
| `mcpServers` | `Record<string, MCPServerConfig>` | `undefined` | MCP servers to connect on startup. |
| `builtInTools` | `BuiltinToolsOptions \| false` | *(7 core tools enabled; interactive tools off)* | `readOnly: true` registers only the read-only core tools (FileRead/Glob/Grep/WebFetch); `askUser`/`todoWrite`/`subAgent` enable interactive tools (all off by default); `false` to disable all built-in tools. |
| `clientInfo` | `{ name: string; version: string }` | `{ name: "agent-core", version: "0.0.0" }` | Client identity sent to MCP servers. |
| `sessionId` | `string` | `randomUUID()` | Unique session identifier, used as key for persistence. |
| `persistence` | `SessionPersistence` | `undefined` | Persistence backend for save/resume. When set, the session auto-saves after every turn. |
| `maxTurns` | `number` | `50` | Maximum agent turns (LLM calls with tool calls) per prompt before the run errors out. |
| `stallThreshold` | `number` | `3` | Stall tolerance: consecutive identical tool-call sets, or consecutive text-only responses while todos are incomplete, before the run is treated as stalled. |

The auto-compaction threshold is not configurable — it's derived internally as 75% of `llm.maxInputTokens` and exposed via `session.contextLimit`.

---

## `SYSTEM_PROMPT_BOUNDARY`

**`SYSTEM_PROMPT_BOUNDARY: string`**

A constant separator that `createSession` appends between the user-provided `systemPrompt` and the auto-generated tool-use/behavior guidelines. Also exported so callers can use it when composing their own system prompt from multiple segments:

```ts
import { SYSTEM_PROMPT_BOUNDARY } from "@vietor/agent-core";

const systemPrompt = [
  coreInstructions,
  contextRules,
].join(SYSTEM_PROMPT_BOUNDARY);
```

---

## `Session`

The main session object. Create one via `createSession()` — it wires the LLM client, tool registry, and MCP servers, and connects MCP servers listed in `mcp`:

```ts
const session = await createSession({ systemPrompt, llm });
```

### Running prompts

| Method | Description |
|---|---|
| `prompt(text: string): Promise<PromptResult>` | Submit a user message and run the agent loop (LLM → tool calls → LLM) until a final answer or error. Returns a `PromptResult` with the run `status` and the final assistant `reply`. |

### Managing conversation

| Method | Description |
|---|---|
| `clear(): void` | Reset the conversation and log. |
| `restore(): Promise<boolean>` | Reload persisted messages and todos from the `SessionPersistence` backend into the session. Returns `false` (loading nothing) when the backend has no saved state for this session. |
| `export(): SessionMessage[]` | Return all session messages (excluding the system prompt). |
| `compact(): Promise<RunStatus>` | Ask the LLM to summarize the conversation so far, replacing history with a single summary message. Runs through the run loop — streams the summary and can be aborted via `abort()`. |
| `abort(): void` | Abort the current prompt or compact, cancel pending tool calls, and dismiss unanswered user questions. |
| `submitAnswer(id: string, answer: string): void` | Supply an answer to a pending user question (from the built-in AskUser tool). |
| `pendingQuestion(): Extract<TimelineEvent, { type: "question" }> \| undefined` | Return the most recent unanswered question, or `undefined` if none are pending. |

### Events

| Method | Description |
|---|---|
| `onEvent(listener: (e: AgentEvent) => void): () => void` | Subscribe to structured incremental events (streaming deltas, tool calls, errors, questions, run state). Supports multiple listeners; returns an unsubscribe function. |
| `flush(): Promise<void>` | Resolve once all pending persistence writes for this session have settled. |

#### `AgentEvent`

A discriminated union emitted as the session runs. Every variant carries a `persisted` flag: `true` for events that are also stored in the timeline, `false` for transient streaming/run-state events.

```ts
type AgentEvent =
  | { type: "user"; text: string; persisted: true }
  | { type: "skill"; name: string; persisted: true }
  | { type: "assistant"; text: string; persisted: true }
  | { type: "tool"; id: string; name: string; argsSummary: string; result: string | null; isError?: boolean; resultSummary?: string; persisted: true }
  | { type: "retry"; attempt: number; max: number; reason: string; persisted: true }
  | { type: "error"; text: string; persisted: true }
  | { type: "interrupted"; persisted: true }
  | { type: "question"; id: string; text: string; options: string[]; answer: string | null; persisted: true }
  | { type: "notice"; text: string; persisted: true }
  | { type: "assistantDelta"; text: string; persisted: false }
  | { type: "thinkingDelta"; text: string; persisted: false }
  | { type: "thinkingClear"; persisted: false }
  | { type: "toolStart"; id: string; name: string; argsSummary: string; persisted: false }
  | { type: "toolEnd"; id: string; result: string; isError?: boolean; resultSummary?: string; persisted: false }
  | { type: "runMetrics"; running: boolean; elapsed: number; thinkingElapsed: number; replyElapsed: number; inputTokens: number; outputTokens: number; persisted: false };
```

| Type | Emitted when | In timeline |
|---|---|---|
| `user` | User submits a prompt (`prompt`). | ✓ |
| `skill` | A skill is invoked. | ✓ |
| `assistantDelta` | A streaming token delta from the LLM. | — |
| `thinkingDelta` | A streaming thinking token delta (extended thinking). | — |
| `thinkingClear` | Clears the accumulated thinking text (e.g. on new tool round). | — |
| `assistant` | A text response segment is flushed (on tool call or completion). | ✓ |
| `toolStart` | A tool call starts. | ✓ (stored as `tool`) |
| `toolEnd` | A tool call finishes. | — (merged into its `tool` entry) |
| `retry` | The LLM client retries after a transient API error. | ✓ |
| `error` | An error occurred. | ✓ |
| `interrupted` | The current run was aborted. | ✓ |
| `question` | The AskUser tool poses a question. | ✓ |
| `notice` | `session.addNotice()` is called, or the run auto-compacts context. | ✓ |
| `runMetrics` | Run metrics change: at run start, every second, and at run end (`running: false`). | — |

Note: `onEvent` is the primary stream for network/remote consumers (multi-subscriber, incremental). For local React `useSyncExternalStore` view invalidation use `subscribe` + `getSnapshot`.

#### `RunMetrics`

```ts
interface RunMetrics {
  running: boolean;        // whether a prompt is in progress
  elapsed: number;         // seconds since the current prompt started
  thinkingElapsed: number; // seconds before the first assistant text token (incl. thinking/tools)
  replyElapsed: number;    // seconds after the first assistant text token (incl. later tool rounds)
  inputTokens: number;     // cumulative input (prompt) tokens for the current run
  outputTokens: number;    // cumulative output (completion) tokens for the current run
}
```

`INITIAL_RUN_METRICS: RunMetrics` is the all-zero, not-running initial value.

### Skills & messages

The command system lives in host code. Core exposes the primitives hosts build on:

| Method | Description |
|---|---|
| `runSkill(name: string): Promise<boolean>` | Run a skill by name through the agent loop. Returns `false` (no error emitted) if the name is unknown; throws `SessionBusyError` if a run is in progress. |
| `addNotice(text: string): void` | Append a notice entry to the timeline and emit a `notice` event. |
| `addError(text: string): void` | Append an error entry to the timeline and emit an `error` event. |
| `skills: readonly Skill[]` | All loaded skills. |

### State accessors

| Property | Type | Description |
|---|---|---|
| `model` | `string` | The LLM model name (e.g. `"deepseek-v4-flash"`). |
| `thinkingEffort` | `"high" \| "max"` | The configured thinking effort. |
| `contextLimit` | `number` | Estimated-token threshold that triggers auto-compaction. |
| `mcpServers` | `readonly MCPServerInfo[]` | Status and tool list of connected MCP servers. |
| `contextTokens` | `number` | Estimated token count of the current conversation. |
| `running` | `boolean` | Whether a prompt/compact is in progress. Check before issuing a driver call (see Reentrancy). |

### Reentrancy

A `Session` runs one prompt/compact at a time. While a run is in progress, calling a **driver** method throws `SessionBusyError` so a host can map it to an HTTP 409:

| Driver method | Behavior when busy |
|---|---|
| `prompt`, `compact`, `runSkill`, `clear`, `restore` | Throws `SessionBusyError`. |

These remain callable during a run (they are inputs to the running loop, or read-only/teardown):

| Method | Behavior when busy |
|---|---|
| `abort`, `submitAnswer` | Allowed - control the running loop. |
| `onEvent`, `subscribe`, `getSnapshot`, `pendingQuestion`, `export`, `flush`, `dispose`, accessors | Allowed. |

```ts
import { SessionBusyError } from "@vietor/agent-core";

if (!session.running) {
  try {
    await session.prompt(text);
  } catch (e) {
    if (e instanceof SessionBusyError) /* -> HTTP 409 */;
  }
}
```

The `runMetrics` event (`running: boolean`) also signals run start/end for stream consumers.

### Snapshot subscription

| Method | Description |
|---|---|
| `subscribe(listener: () => void): () => void` | Subscribe to timeline or todo changes; returns an unsubscribe function. |
| `getSnapshot(): SessionView` | Current session snapshot (`{ timeline, todos }`); the reference stays stable until the next change. Designed for `useSyncExternalStore`. |

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
  timeline: readonly TimelineEvent[];
  todos: readonly Todo[];
}
```

### `PromptResult`

Returned by `session.prompt()`.

```ts
interface PromptResult {
  status: RunStatus;
  reply: string;
}
```

`status` indicates how the run ended; `reply` is the final assistant text (may be partial or empty when `status !== "ok"`). Error details are delivered via the `error` event; subscribe to `onEvent` for the full picture.

### `RunStatus`

```ts
type RunStatus = "ok" | "aborted" | "error" | "stalled" | "maxTurns";
```

| Status | Meaning |
|---|---|
| `ok` | The run completed with a final assistant reply. |
| `aborted` | The run was aborted via `abort()`. |
| `error` | The run ended due to an LLM/API error. |
| `stalled` | The agent stalled past `stallThreshold`: repeated identical tool calls, or repeated text-only responses while todos are incomplete. |
| `maxTurns` | The agent exceeded `maxTurns`. |

Also returned by `session.compact()` (`"ok"` on success, `"aborted"` if aborted, `"error"` on failure).

### `Timeline`

`SessionView.timeline` is `readonly TimelineEvent[]` — a derived alias for the persisted subset of `AgentEvent`: `TimelineEvent = Extract<AgentEvent, { persisted: true }>` (`user`, `skill`, `assistant`, `tool`, `retry`, `error`, `interrupted`, `question`, `notice`). Transient events (`assistantDelta`, `thinkingDelta`, `thinkingClear`, `toolStart`/`toolEnd`, `runMetrics`) are never stored; `toolEnd` is merged into its `tool` entry.

`tool` and `question` entries carry lifecycle state as pending fields, set `null` while outstanding and replaced on completion:

| Field | Meaning |
|---|---|
| `result: string \| null` (`tool`) | `null` while the tool is running; the result text once `tool_end` arrives, or `"aborted"` if the run was interrupted. |
| `isError?: boolean` / `resultSummary?: string` (`tool`) | Set when the tool ended with an error / a condensed summary of the result. |
| `answer: string \| null` (`question`) | `null` until the user answers (via `submitAnswer` or `abort`). |

### `SessionMessage`

The internal message format exchanged with the agent, also returned by `session.export()`.

```ts
type SessionMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "skill"; name: string; content: string }
  | LLMAssistantMessage
  | { role: "tool"; tool_call_id: string; content: string; resultSummary?: string; isError?: boolean };

// LLMAssistantMessage includes optional tool_calls[] for function-calling
```

### `LLMConfig`

```ts
interface LLMConfig {
  baseUrl: string;            // API endpoint (e.g. "https://api.deepseek.com/v1" or "https://api.anthropic.com") — required
  apiKey: string;             // API key — required
  model: string;              // Model name (e.g. "deepseek-v4-flash" or "claude-sonnet-5") — required
  thinkingEffort?: LLMThinkingEffort;  // Thinking depth; "high" for standard tasks, "max" for deeper thinking on complex tasks (default: "high")
  backend?: LLMBackend;  // Wire protocol; "completions" (OpenAI Chat Completions), "anthropic" (Anthropic Messages API via the official SDK), or "responses" (OpenAI Responses API via the official SDK) (default: "completions")
  maxInputTokens?: number;    // Context window in tokens; 75% of it is used as the auto-compaction threshold (default: 1,000,000)
  maxOutputTokens?: number;   // Max output tokens per request, capped by the model's output limit (default: 128,000)
}

type LLMThinkingEffort = "high" | "max";

type LLMBackend = "completions" | "anthropic" | "responses";
```

Both aliases are exported so hosts can reference them in their own config types.

`backend` selects the request/response protocol the client speaks:

- `"completions"` - OpenAI Chat Completions compatible endpoint. `thinkingEffort` is sent as `reasoning_effort`; `maxOutputTokens` is sent as `max_tokens`.
- `"anthropic"` - Anthropic Messages API (via `@anthropic-ai/sdk`). Point `baseUrl` at an Anthropic-compatible endpoint and `model` at a Claude model. `maxOutputTokens` is sent as `max_tokens`; `thinkingEffort` enables extended thinking (`"high"` = 16k token budget, `"max"` = 32k, both capped by `maxOutputTokens`); thinking blocks are preserved across tool-use turns as required by the API.
- `"responses"` - OpenAI Responses API (via `openai` SDK). Tool results round-trip as `function_call`/`function_call_output` items; `maxOutputTokens` is sent as `max_output_tokens`; `thinkingEffort` is sent as `reasoning.effort`, and reasoning summaries are streamed via `reasoning.summary_text`.

### `SessionPersistence`

Async interface for save/resume. Implement to persist session state between runs (filesystem, database, etc.).

```ts
interface SessionPersistence {
  load(sessionId: string): Promise<SessionData | null>;
  saveAll(sessionId: string, state: SessionData): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  delete?(sessionId: string): Promise<void>;
}
```

`SessionData` is what `load`/`saveAll` persist per session:

```ts
interface SessionData {
  messages: SessionMessage[];
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

type TodoStatus = "pending" | "inProgress" | "completed";
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
  summaryKeys?: string[];                // parameter keys used for display summary
  summarizeArgs?: (args: Record<string, unknown>) => string; // custom summary function
  summarizeResult?(result: TextResult): string; // result summary for timeline display
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<TextResult>;
}
```

- `readOnly` (optional) marks the tool as read-only. Read-only tools are what `builtInTools: { readOnly: true }` registers, and what the SubAgent tool equips sub-agents with.
- `parameters` is passed to the LLM as a JSON Schema to describe the tool's arguments.
- When the LLM calls a tool, `execute` receives the parsed arguments and a context object.
- `execute` returns a `TextResult` (`{ content, isError? }`). Expected failures return `toolError(...)` (exported from the package); unexpected errors may throw and are wrapped by the registry.
- `summaryKeys` / `summarizeArgs` control what appears in the tool log entry's `argsSummary` field.
- `summarizeResult` (optional) returns a short result summary for timeline display. Called after execution with the result; the registry prefixes the wall-clock duration. Falls back to a default summary (byte/line count) when not defined.

### `ToolContext`

```ts
interface ToolContext {
  signal?: AbortSignal;  // abort signal for the current run
  cwd: string;           // resolved working directory for path-based tools
}
```

### `TextResult`

```ts
interface TextResult {
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

Core tools (registered by default; `builtInTools: { readOnly: true }` registers only the read-only subset):

| Tool | Description |
|---|---|
| **FileRead** *(read-only)* | Read files with line numbers. |
| **Glob** *(read-only)* | File listing by glob pattern. |
| **Grep** *(read-only)* | Content search with regex. |
| **WebFetch** *(read-only)* | General-purpose HTTP GET — converts HTML to markdown, returns JSON/XML/text raw. Retries transient failures (network, timeouts, 408/429/5xx) up to 3 attempts. |
| **Shell** | Run shell commands. |
| **FileWrite** | Create or overwrite files. |
| **FileEdit** | Surgical text replacement. |

Interactive tools are **off by default** and registered only when explicitly enabled via `builtInTools` (`askUser: true`, `todoWrite: true`, `subAgent: true`):

| Tool | Description |
|---|---|
| **AskUser** | Ask the user a question and wait for the answer. |
| **TodoWrite** | Track multi-step task progress; the agent must complete every task before its final reply. |
| **Skill** | Invoke a skill by name; loads its instructions into context. Registered automatically whenever `skills` are provided. |
| **SubAgent** | Run a nested sub-agent: read-only "explore" investigation or "plan" implementation planning. Sub-agents are equipped with the session's read-only tools (FileRead/Glob/Grep/WebFetch, plus any custom tools marked `readOnly`). |

`builtInTools: false` disables all built-in tools.

```ts
const session = await createSession({
  systemPrompt: "...",
  llm: { ... },
  builtInTools: { askUser: true, todoWrite: true },
});
// Disable all built-in tools:
// builtInTools: false
// Read-only session (no Shell / FileWrite / FileEdit):
// builtInTools: { readOnly: true }
```

### Custom tools example

```ts
import type { Tool } from "@vietor/agent-core";

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
  llm: { ... },
  tools: [greetTool],
});
```

---

## Command System

Slash commands are a **host-side (UI) concept** — the core package no longer ships a command system. Hosts implement their own dispatcher on top of the session primitives: `prompt()`, `runSkill()`, `addNotice()`, `addError()`, and the `skills` getter.

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
  llm: { ... },
  skills,
});
```

---

## MCP (Model Context Protocol)

### `MCPServerConfig`

```ts
type MCPServerConfig = StdioServerConfig | HttpServerConfig;

interface StdioServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;    // set false to skip this server
}

interface HttpServerConfig {
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

All utilities below are exported from the `@vietor/agent-core/util` subpath.

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
import { htmlToMarkdown } from "@vietor/agent-core/util";

const md = htmlToMarkdown("<h1>Hello</h1><p>World</p>");
// "# Hello\n\nWorld"
```

### `getTextBytes`

**`getTextBytes(content: string): number`**

Return the UTF-8 byte length of a string (via `Buffer.byteLength`).

```ts
import { getTextBytes } from "@vietor/agent-core/util";

const bytes = getTextBytes("Hello");   // 5
```

### `formatSeconds`

**`formatSeconds(value: number): string`**

Format a duration in seconds for display (e.g. `3.2s`). Used for tool-result summaries.

```ts
import { formatSeconds } from "@vietor/agent-core/util";

formatSeconds(3.24);   // "3.24s"
```

### `formatCompactNumber`

**`formatCompactNumber(value: number): string`**

Format a number compactly (e.g. `1.2K`). Used for byte/line counts in summaries.

```ts
import { formatCompactNumber } from "@vietor/agent-core/util";

formatCompactNumber(1234);   // "1.23K"
```

### `truncateText`

**`truncateText(content: string, length: number, showChars?: boolean): string`**

Collapse whitespace and truncate text to `length` characters with a trailing `…`. With `showChars`, append the total character count when truncated — useful for text that changes size over time.

```ts
import { truncateText } from "@vietor/agent-core/util";

truncateText("a\nvery   long line", 8);              // "a very l…"
truncateText("a very long line here", 8, true);      // "a very l… (21)"
```

### `toErrorMessage`

**`toErrorMessage(e: unknown): string`**

Stringify an unknown error for display (`e instanceof Error ? e.message : String(e)`). Used across core for error events.

```ts
import { toErrorMessage } from "@vietor/agent-core/util";

toErrorMessage(new Error("boom"));   // "boom"
toErrorMessage("oops");              // "oops"
```

### `netFetch`

**`netFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`**

A drop-in replacement for `fetch` that automatically routes through an HTTP(S) proxy when configured. Respects the standard environment variables:

- `HTTPS_PROXY` / `https_proxy` — proxy URL for HTTPS requests (preferred)
- `HTTP_PROXY` / `http_proxy` — proxy URL for HTTP requests (fallback)
- `NO_PROXY` / `no_proxy` — comma-separated hostnames/domains to bypass the proxy

```ts
import { netFetch } from "@vietor/agent-core/util";

// Same signature as fetch — automatically uses proxy if env vars are set
const res = await netFetch("https://api.example.com/data");
const data = await res.json();
```

### `runProcess`

**`runProcess(cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }, signal?: AbortSignal): Promise<ProcessResult>`**

Run a subprocess, capturing stdout and stderr (used by the built-in Shell tool). The promise never rejects — spawn failures, timeouts, and output over the 10MB cap are reported via `ProcessResult.error`. Pass a `timeout` (ms) or an `AbortSignal` to kill the process tree.

```ts
import { runProcess } from "@vietor/agent-core/util";

const result = await runProcess("ls", ["-la"], { cwd: "./src" });
if (result.error) console.error(result.error.message);
else console.log(result.stdout, result.status);
```

### `ProcessResult`

Returned by `runProcess`.

```ts
interface ProcessResult {
  stdout: string;
  stderr: string;
  status: number | null;  // exit code; null when killed (signal, abort, timeout, buffer overflow)
  error?: Error;          // spawn failure, timeout, or output exceeded the 10MB cap
  truncated?: boolean;    // true when output was cut off at the 10MB cap
}
```

### `MAX_SUMMARY_LENGTH`

**`MAX_SUMMARY_LENGTH: number`** (`75`)

The character cap the tool registry applies when truncating tool results into timeline summaries.

```ts
import { MAX_SUMMARY_LENGTH } from "@vietor/agent-core/util";

const summary = result.length > MAX_SUMMARY_LENGTH ? `${result.slice(0, MAX_SUMMARY_LENGTH)}…` : result;
```

---

## Full Quick Start

```ts
import { createSession, tryLoadSkills } from "@vietor/agent-core";

const session = await createSession({
  systemPrompt: "You are a helpful assistant.",
  llm: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your-api-key",
    model: "deepseek-v4-flash",
    thinkingEffort: "high",
    backend: "completions",
    maxInputTokens: 1_000_000,
  },
  mcpServers: {
    filesystem: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  },
});

session.onEvent((e) => {
  if (e.type === "assistantDelta") process.stdout.write(e.text);
  else if (e.type === "runMetrics")
    console.log(`tokens: ${e.inputTokens} prompt / ${e.outputTokens} completion`);
});

const result = await session.prompt("What files are in the current directory?");
console.log(result.reply);                // final assistant reply

console.log(session.getSnapshot().timeline);   // full session timeline
console.log(session.export());     // LLM message history
session.dispose();
```
