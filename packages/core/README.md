# @vietor/agent-core

> Lightweight AI agent framework — session orchestration, tool system, MCP client, skill loader.

```bash
npm install @vietor/agent-core
```

Requires Node.js ≥ 22 (ESM only).

## Import paths

The package exposes two entry points:

| Import | Contents |
|---|---|
| `@vietor/agent-core` | `createSession`, the `Session` API, tools, skills, MCP, LLM config, shared types |
| `@vietor/agent-core/util` | Framework utilities: async helpers, text formatting, subprocess, file/HTML/net helpers, constants |

```ts
import { createSession, type Tool } from "@vietor/agent-core";
import { runProcess, formatDuration } from "@vietor/agent-core/util";
```

---

## Quick Start

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
  if (e.type === "assistant_delta") process.stdout.write(e.text);
  else if (e.type === "run_metrics") {
    const inputTokens = e.cacheInputTokens + e.missInputTokens;
    console.log(`tokens: ${inputTokens} input / ${e.outputTokens} output`);
  }
});

const result = await session.prompt("What files are in the current directory?");
console.log(result.reply);                // final assistant reply

console.log(session.getSnapshot().timeline);   // full session timeline
console.log(session.exportState());   // full session state: messages + todos
session.dispose();
```

---

# API Reference — `@vietor/agent-core`

## `createSession`

**`createSession(options: SessionOptions): Promise<Session>`**

Factory that wires together the LLM client, tool registry, MCP servers, and skills into a ready-to-use `Session` instance. Connects the MCP servers listed in `mcpServers` before resolving.

```ts
import { createSession, LLMConfigSchema } from "@vietor/agent-core";

const session = await createSession({
  systemPrompt: "You are a helpful assistant.",
  llm: LLMConfigSchema.parse({
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "your-api-key",
    model: "deepseek-v4-flash",
    thinkingEffort: "high",
    backend: "completions",
    maxInputTokens: 1_000_000,
  }),
  tools: [myCustomTool],
  skills: tryLoadSkills("./skills") ?? [],
  mcpServers: {
    filesystem: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
  },
  builtInTools: { askUser: true },
  clientInfo: { name: "my-app", version: "1.0.0" },
});
```

## `SessionOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `systemPrompt` | `string` | *(required)* | System prompt for the LLM. |
| `llm` | `LLMConfig` | *(required)* | LLM endpoint config (OpenAI-compatible or Anthropic; see `backend`). Only `baseUrl`, `apiKey`, and `model` are required; `thinkingEffort`, `backend`, `maxInputTokens`, and `maxOutputTokens` default to `"high"`, `"completions"`, `1_000_000`, and `128_000`, the last two with minimums of `128_000` and `48_000`. |
| `cwd` | `string` | `process.cwd()` | Working directory used by tools (e.g. path-based tools). |
| `tools` | `Tool[]` | `undefined` | Additional tools registered alongside built-ins. |
| `skills` | `Skill[]` | `undefined` | Skills loaded from SKILL.md files; invoked via the built-in Skill tool or via `session.runSkill()` (hosts may map them to slash commands). |
| `mcpServers` | `Record<string, MCPServerConfig>` | `undefined` | MCP servers to connect on startup. |
| `builtInTools` | `BuiltinToolsOptions \| false` | *(7 core tools enabled; interactive tools off)* | `readOnly: true` registers only the read-only core tools (Read/Glob/Grep/WebFetch); `askUser`/`todoWrite`/`subAgent` enable interactive tools (all off by default); `false` to disable all built-in tools. |
| `clientInfo` | `{ name: string; version: string }` | `{ name: "agent-core", version: "0.0.0" }` | Client identity sent to MCP servers. |
| `sessionId` | `string` | `randomUUID()` | Unique session identifier. |
| `maxTurns` | `number` | `50` | Maximum agent turns (LLM calls with tool calls) per prompt before the run errors out. |
| `stallThreshold` | `number` | `3` | Stall tolerance: consecutive identical tool-call sets, or consecutive text-only responses while todos are incomplete, before the run is treated as stalled. |
| `maxParallelToolCalls` | `number` | `10` | Maximum number of tool calls executed concurrently in one turn. |

`maxTurns`, `stallThreshold`, and `maxParallelToolCalls` must be positive integers; `createSession` throws at construction otherwise.

The auto-compaction threshold is not configurable — it's derived internally as 75% of `llm.maxInputTokens` and exposed via `session.contextLimit`.

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

## `Session`

The main session object. Create one via `createSession()` — it wires the LLM client, tool registry, and MCP servers, and connects the MCP servers listed in `mcpServers`:

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
| `importState(state: SessionState): void` | Replace conversation messages and todos from a previously exported `SessionState`, rebuilding the timeline. Throws `SessionBusyError` if a run is in progress. |
| `export(): SessionMessage[]` | Return all session messages (excluding the system prompt). |
| `exportState(): SessionState` | Return the full session state (`{ messages, todos }`) for the host to persist; `export()` returns only messages. |
| `compact(): Promise<RunStatus>` | Ask the LLM to summarize the conversation so far, replacing history with a single summary message. Runs through the run loop — streams the summary and can be aborted via `abort()`. |
| `abort(): void` | Abort the current prompt or compact, cancel pending tool calls, and dismiss unanswered user questions. |
| `submitAnswer(id: string, answers: AskAnswer[]): void` | Supply answers to a pending user question group (from the built-in AskUser tool), one entry per question; multi-select answers are `string[]`, skipped ones `""`. |
| `pendingQuestion: Extract<TimelineEvent, { type: "question" }> \| undefined` | *(getter)* The most recent unanswered question group, or `undefined` if none are pending. |

### Asking the user

The built-in **AskUser** tool takes 1-4 questions in one call; each question has an optional `header` (≤ 12 chars), 2-4 `options` with optional `description`s, and an optional `multiSelect` flag:

```ts
{
  questions: [
    { header: "Deploy", question: "Which environment?", options: [{ label: "prod" }, { label: "staging" }], multiSelect: false },
    { question: "Notify on?", options: [{ label: "email" }, { label: "slack" }], multiSelect: true },
  ],
}
```

The session emits one `question` timeline entry (also delivered via `onEvent`) — each item is an `AskedQuestion` (an `AskQuestion` plus an `answer` field, `null` while pending) — and pauses the run until answered:

```ts
{ type: "question", id: "q1", questions: [{ question: "Which environment?", options: [...], multiSelect: false, answer: null }, ...] }
```

The host renders the questions and supplies one answer per question via `submitAnswer` — `string` for single-select, `string[]` for multi-select, `""` to skip:

```ts
session.submitAnswer("q1", ["prod", ["email", "slack"]]);
```

The tool result fed back to the LLM is JSON keyed by question text; multi-select values are arrays of selected labels, skipped questions `""`:

```json
{ "Which environment?": "prod", "Notify on?": ["email", "slack"] }
```

`abort()` (or `dispose()`) resolves any pending question group with all-`""` answers and stops the run.

### Events

| Method | Description |
|---|---|
| `onEvent(listener: (e: SessionEvent) => void): () => void` | Subscribe to structured incremental events (streaming deltas, tool calls, errors, questions, run state). Supports multiple listeners; returns an unsubscribe function. |

#### `SessionEvent`

A discriminated union emitted as the session runs — the union of the standalone `TimelineEvent` and `StreamEvent` types:

```ts
type SessionEvent = TimelineEvent | StreamEvent;
```

Timeline events are also stored in `session.getSnapshot().timeline`:

```ts
type TimelineEvent =
  | { type: "user"; text: string }
  | { type: "skill"; name: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; id: string; name: string; argsSummary: string; result: string | null; isError?: boolean; resultSummary?: string }
  | { type: "retry"; attempt: number; max: number; reason: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "question"; id: string; questions: AskedQuestion[] }
  | { type: "notice"; text: string };
```

Streaming events are transient — never stored in the timeline, delivered only to `onEvent` listeners:

```ts
type StreamEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_cleared" }
  | { type: "tool_start"; id: string; name: string; argsSummary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; resultSummary?: string }
  | ({ type: "run_metrics" } & RunMetrics);
```

| Type | Emitted when | In timeline |
|---|---|---|
| `user` | User submits a prompt (`prompt`). | ✓ |
| `skill` | A skill is invoked. | ✓ |
| `assistant_delta` | A streaming token delta from the LLM. | — |
| `thinking_delta` | A streaming thinking token delta (extended thinking). | — |
| `thinking_cleared` | The accumulated thinking text is cleared (e.g. on new tool round). | — |
| `assistant` | A text response segment is flushed (on tool call or completion). | ✓ |
| `tool_start` | A tool call starts. | ✓ (stored as `tool`) |
| `tool_end` | A tool call finishes. | — (merged into its `tool` entry) |
| `retry` | The LLM client retries after a transient API error. | ✓ |
| `error` | An error occurred. | ✓ |
| `interrupted` | The current run was aborted. | ✓ |
| `question` | The AskUser tool poses a group of 1-4 questions. | ✓ |
| `notice` | `session.addNotice()` is called, or the run auto-compacts context. | ✓ |
| `run_metrics` | Run metrics change: at run start, every second, and at run end (`running: false`). | — |

Note: `onEvent` is the primary stream for network/remote consumers (multi-subscriber, incremental). For local React `useSyncExternalStore` view invalidation use `subscribe` + `getSnapshot`.

#### `RunMetrics`

```ts
interface RunMetrics {
  running: boolean;        // whether a prompt is in progress
  elapsed: number;         // seconds since the current prompt started
  thinkingElapsed: number; // seconds before the first assistant text token (incl. thinking/tools)
  replyElapsed: number;    // seconds after the first assistant text token (incl. later tool rounds)
  cacheInputTokens: number; // cumulative cached input (prompt) tokens for the current run
  missInputTokens: number; // cumulative non-cached input (prompt) tokens for the current run
  outputTokens: number;    // cumulative output (completion) tokens for the current run
}
```

`INITIAL_RUN_METRICS: RunMetrics` is the all-zero, not-running initial value.

### Skills & notices

The command system lives in host code. Core exposes the primitives hosts build on:

| Method | Description |
|---|---|
| `runSkill(name: string): Promise<boolean>` | Run a skill by name through the agent loop. Returns `false` (no error emitted) if the name is unknown; throws `SessionBusyError` if a run is in progress. |
| `addNotice(text: string): void` | Append a notice entry to the timeline and emit a `notice` event. |
| `addError(text: string): void` | Append an error entry to the timeline and emit an `error` event. |
| `skills: readonly Skill[]` | *(getter)* All loaded skills. |

### State accessors

| Property | Type | Description |
|---|---|---|
| `model` | `string` | The LLM model name (e.g. `"deepseek-v4-flash"`). |
| `thinkingEffort` | `"high" \| "max"` | The configured thinking effort. |
| `contextLimit` | `number` | Estimated-token threshold that triggers auto-compaction. |
| `contextTokens` | `number` | Estimated token count of the current request: conversation plus tool schemas. |
| `mcpServers` | `readonly MCPServerInfo[]` | Status and tool list of connected MCP servers. |
| `cwd` | `string` | The resolved working directory used by tools. |
| `sessionId` | `string` | The unique session identifier. |
| `running` | `boolean` | Whether a prompt/compact is in progress. Check before issuing a driver call (see Reentrancy). |

### Reentrancy

A `Session` runs one prompt/compact at a time. While a run is in progress, calling a **driver** method throws `SessionBusyError` so a host can map it to an HTTP 409:

| Driver method | Behavior when busy |
|---|---|
| `prompt`, `compact`, `runSkill`, `clear`, `importState` | Throws `SessionBusyError`. |

These remain callable during a run (they are inputs to the running loop, or read-only/teardown):

| Method | Behavior when busy |
|---|---|
| `abort`, `submitAnswer` | Allowed - control the running loop. |
| `onEvent`, `subscribe`, `getSnapshot`, `pendingQuestion`, `export`, `exportState`, `dispose`, accessors | Allowed. |

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

The `run_metrics` event (`running: boolean`) also signals run start/end for stream consumers.

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

### `PendingQuestion`

The `question` timeline entry returned by `session.pendingQuestion`.

```ts
type PendingQuestion = Extract<TimelineEvent, { type: "question" }>;
```

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

`SessionView.timeline` is `readonly TimelineEvent[]` — a standalone union of nine entry types (`user`, `skill`, `assistant`, `tool`, `retry`, `error`, `interrupted`, `question`, `notice`), defined independently of the event stream. Transient stream events (`assistant_delta`, `thinking_delta`, `thinking_cleared`, `tool_start`/`tool_end`, `run_metrics`) are never stored; `tool_start` opens a `tool` entry with `result: null` and `tool_end` is merged into it.

`tool` and `question` entries carry lifecycle state as pending fields, set `null` while outstanding and replaced on completion:

| Field | Meaning |
|---|---|
| `result: string \| null` (`tool`) | `null` while the tool is running; the result text once `tool_end` arrives, or `"aborted"` if the run was interrupted. |
| `isError?: boolean` / `resultSummary?: string` (`tool`) | Set when the tool ended with an error / a condensed summary of the result. |
| `questions: AskedQuestion[]` (`question`) | The question group; each item is an `AskQuestion` (`header?`, `question`, `options: {label, description?}[]`, `multiSelect`) with an `answer` field: `string` for single-select, `string[]` for multi-select, `""` when skipped; `null` until answered (via `submitAnswer` or `abort`). |

### `SessionMessage`

The internal message format exchanged with the agent, as contained in `session.exportState().messages`.

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

`LLMConfigSchema` is the single source of truth (hosts compose it into their own config schema); `LLMConfig` is its input shape and `ResolvedLLMConfig` its parsed shape, with every default applied:

```ts
const LLMConfigSchema = z.object({
  baseUrl: z.string(),            // API endpoint (e.g. "https://api.deepseek.com/v1" or "https://api.anthropic.com") — required
  apiKey: z.string(),             // API key — required
  model: z.string(),              // Model name (e.g. "deepseek-v4-flash" or "claude-sonnet-5") — required
  thinkingEffort: z.enum(["high", "max"]).default("high"),  // Thinking depth; "high" for standard tasks, "max" for deeper thinking on complex tasks
  backend: z.enum(["completions", "anthropic", "responses"]).default("completions"),  // Wire protocol; "completions" (OpenAI Chat Completions), "anthropic" (Anthropic Messages API via the official SDK), or "responses" (OpenAI Responses API via the official SDK)
  maxInputTokens: z.int().min(128_000).default(1_000_000),  // Context window in tokens (min 128_000); 75% of it is used as the auto-compaction threshold
  maxOutputTokens: z.int().min(48_000).default(128_000),    // Max output tokens per request (min 48_000), capped by the model's output limit
});

type LLMConfig = z.input<typeof LLMConfigSchema>;

type ResolvedLLMConfig = z.infer<typeof LLMConfigSchema>;

type LLMThinkingEffort = ResolvedLLMConfig["thinkingEffort"];

type LLMBackend = ResolvedLLMConfig["backend"];
```

`createSession` and `createLLM` take `LLMConfig`, where only `baseUrl`, `apiKey`, and `model` are required. The schema is applied at the boundary, so every field is set on the `ResolvedLLMConfig` that reaches the client and its adapters. `z` is re-exported from the package root, so hosts composing these schemas into their own do not need a zod dependency of their own.

`backend` selects the request/response protocol the client speaks:

- `"completions"` - OpenAI Chat Completions compatible endpoint. `thinkingEffort` is sent as `reasoning_effort`; `maxOutputTokens` is sent as `max_tokens`.
- `"anthropic"` - Anthropic Messages API (via `@anthropic-ai/sdk`). Point `baseUrl` at an Anthropic-compatible endpoint and `model` at a Claude model. `maxOutputTokens` is sent as `max_tokens`; `thinkingEffort` enables extended thinking (`"high"` = 16k token budget, `"max"` = 32k, both capped by `maxOutputTokens`); thinking blocks are preserved across tool-use turns as required by the API.
- `"responses"` - OpenAI Responses API (via `openai` SDK). Tool results round-trip as `function_call`/`function_call_output` items; `maxOutputTokens` is sent as `max_output_tokens`; `thinkingEffort` is sent as `reasoning.effort`, and reasoning summaries are streamed via `reasoning.summary_text`.

### `SessionState`

The payload exchanged with a host's persistence layer — the complete state to save and the input to restore:

```ts
interface SessionState {
  messages: SessionMessage[];
  todos: Todo[];
}
```

Core has no storage backend and never saves on its own. The host calls `session.exportState()` to snapshot the current state (e.g. after each prompt) and `session.importState(state)` to restore one — import is synchronous and rebuilds the timeline from the messages. Storage concerns (serialization, file layout, write serialization) are entirely the host's; `sessionId` is the suggested storage key.

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
  agentLevel?: AgentLevel;   // 0 = never granted to sub-agents; 1 = read-only sub-agents; 2 = writable sub-agents only
  description: string;
  parameters: Record<string, unknown>;   // JSON Schema object
  argSummaryKeys?: string[];                // parameter keys used for display summary
  summarizeArgs?: (args: Record<string, unknown>) => string; // custom summary function
  summarizeResult?(result: TextResult): string; // result summary for timeline display
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<TextResult>;
}
```

- `agentLevel` (optional, default `0`) declares which sub-agents may use the tool: `0` = never granted to any sub-agent; `1` = granted to read-only sub-agents ("explore"/"plan"), which therefore also reaches writable ones; `2` = granted only to writable sub-agents ("general"). Tools with `agentLevel: 1` are what `builtInTools: { readOnly: true }` registers (Read/Glob/Grep/WebFetch). If you previously marked a custom tool `readOnly: true` to expose it to sub-agents, set `agentLevel: 1`; use `agentLevel: 2` for custom writable tools meant for the general sub-agent only. AskUser/Skill/TodoWrite/SubAgent are session-scoped and stay at `0`.
- `parameters` is passed to the LLM as a JSON Schema to describe the tool's arguments.
- When the LLM calls a tool, `execute` receives the parsed arguments and a context object.
- `execute` returns a `TextResult` (`{ content, isError? }`). Expected failures return `toolError(...)` (exported from the package); unexpected errors may throw and are wrapped by the registry.
- `argSummaryKeys` / `summarizeArgs` control what appears in the tool log entry's `argsSummary` field.
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
| **Read** *(read-only)* | Read files with line numbers. |
| **Glob** *(read-only)* | File listing by glob pattern. |
| **Grep** *(read-only)* | Content search with regex. |
| **WebFetch** *(read-only)* | General-purpose HTTP GET — converts HTML to markdown, returns JSON/XML/text raw. Retries transient failures (network, timeouts, 408/429/5xx) up to 3 attempts. |
| **Shell** | Run shell commands. |
| **Write** | Create or overwrite files. |
| **Edit** | Surgical text replacement. |

Interactive tools are **off by default** and registered only when explicitly enabled via `builtInTools` (`askUser: true`, `todoWrite: true`, `subAgent: true`):

| Tool | Description |
|---|---|
| **AskUser** | Ask the user 1-4 questions in one call (each with 2-4 options and optional multi-select) and wait for the answers. |
| **TodoWrite** | Track multi-step task progress; the agent must complete every task before its final reply. |
| **Skill** | Invoke a skill by name; loads its instructions into context. Registered automatically whenever `skills` are provided. |
| **SubAgent** | Run a nested sub-agent. Types: "explore" — read-only fan-out investigation; "plan" — read-only implementation planning; "general" — writable executor that may modify files and run shell commands, for delegating whole implementation chunks (run several in parallel for multi-task work). Tool grants follow each tool's `agentLevel`: read-only sub-agents get level-1 tools, "general" gets level 1+2; level-0 tools (AskUser/Skill/TodoWrite/SubAgent) are never delegated. When the session is built read-only (`builtInTools: { readOnly: true }`), "general" is not offered and the tool falls back to explore/plan only. Sub-agents return only their final report — verify their changes yourself. |

`builtInTools: false` disables all built-in tools.

```ts
const session = await createSession({
  systemPrompt: "...",
  llm: { ... },
  builtInTools: { askUser: true, todoWrite: true },
});
// Disable all built-in tools:
// builtInTools: false
// Read-only session (no Shell / Write / Edit):
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

`MCPServerConfigSchema` is the single source of truth (hosts compose it into their own config schema); `MCPServerConfig` is its input shape and `ResolvedMCPServerConfig` its parsed shape:

```ts
const MCPServerConfigSchema = z.union([
  z.object({
    type: z.literal("stdio").default("stdio"),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),    // set false to skip this server
  }),
  z.object({
    type: z.literal("http"),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
]);

type MCPServerConfig = z.input<typeof MCPServerConfigSchema>;

type ResolvedMCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
```

`type` is optional on input for stdio servers — the schema defaults it to `"stdio"`. `mcpServers` on `createSession` and `connectMCP` take `MCPServerConfig`; the manager parses each server at connect time, so `MCPServerInfo.type` is always set and the transport is selected from the parsed shape.

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

### `session.connectMCP`

**`connectMCP(servers: Record<string, MCPServerConfig>): Promise<void>`**

Connect additional MCP servers after session creation. Called internally by `createSession` when `mcpServers` is set; usable by hosts to add servers at runtime.

---

# API Reference — `@vietor/agent-core/util`

All utilities below are exported from the `@vietor/agent-core/util` subpath.

## Async helpers

### `withRetry`

**`withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T>`**

Run `fn` with retry. On a retryable error, waits `backoff(attempt)` (abortable via `opts.signal`) and retries, up to `opts.retries` retries; the last error is rethrown.

```ts
interface RetryOptions {
  retries: number;                    // additional attempts after the first failure
  retryable: (e: unknown) => boolean; // decide whether an error warrants a retry
  backoff: (attempt: number) => number; // delay in ms before retry attempt
  onRetry?: (attempt: number, max: number, error: unknown) => void;
  signal?: AbortSignal;
}
```

### `withTimeout`

**`withTimeout<T>(p: Promise<T>, ms: number): Promise<T>`**

Reject the promise with `Error("timeout after Nms")` if it doesn't settle within `ms`.

### `withTimeoutFn`

**`withTimeoutFn<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, signal: AbortSignal | undefined, timeoutMessage: string, otherError?: (e: unknown) => unknown): Promise<T>`**

The function variant of `withTimeout`: calls `fn` with a signal that aborts on timeout or external abort. On timeout throws `Error(timeoutMessage)`; `otherError` optionally remaps other rejections.

### `withAbort`

**`withAbort<T>(promise: Promise<T>, signal?: AbortSignal, onAbort?: () => T): Promise<T>`**

Race `promise` against `signal`. On abort, resolves `onAbort()` if provided, otherwise rejects with `AbortedError`. Pass no `signal` to return the promise untouched.

### `AbortedError`

**`class AbortedError extends Error`**

Thrown by `withAbort` (and abortable retry sleeps) when an operation is aborted.

### `isAbortError`

**`isAbortError(e: unknown): boolean`**

`true` for `AbortedError`, the DOM `AbortError`, or the LLM SDK's `APIUserAbortError` — use it to distinguish user aborts from real errors.

### `backoffDelay`

**`backoffDelay(attempt: number): number`**

Exponential backoff in ms: `1000 * 2 ** attempt`. Suitable as the `backoff` field of `RetryOptions`.

### `mapWithConcurrency`

**`mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]>`**

Map over `items` in chunks of `limit` concurrent executions (unlike `Promise.all`, never runs more than `limit` at once). Stops scheduling new chunks once `signal` aborts; results keep input order.

## Text helpers

### `formatDuration`

**`formatDuration(value: number): string`**

Format a duration in seconds for display, upgrading to larger units when needed (e.g. `3.2s`, `1m 30s`, `1h 1m 5s`). Used for tool-result summaries and the CLI spinner.

```ts
import { formatDuration } from "@vietor/agent-core/util";

formatDuration(3.24);    // "3.24s"
formatDuration(90.4);    // "1m 30s"
formatDuration(3665);    // "1h 1m 5s"
```

### `formatCompactNumber`

**`formatCompactNumber(value: number): string`**

Format a number compactly (e.g. `1.2K`). Used for byte/line counts in summaries.

```ts
import { formatCompactNumber } from "@vietor/agent-core/util";

formatCompactNumber(1234);   // "1.23K"
```

### `getTextBytes`

**`getTextBytes(content: string): number`**

Return the UTF-8 byte length of a string (via `Buffer.byteLength`).

```ts
import { getTextBytes } from "@vietor/agent-core/util";

const bytes = getTextBytes("Hello");   // 5
```

### `summarizeText`

**`summarizeText(content: string, length: number, showChars?: boolean): string`**

Collapse whitespace and truncate text to `length` characters with a trailing `…`. With `showChars`, append the total character count when truncated — useful for text that changes size over time.

```ts
import { summarizeText } from "@vietor/agent-core/util";

summarizeText("a\nvery   long line", 8);              // "a very l…"
summarizeText("a very long line here", 8, true);      // "a very l… (21)"
```

### `toErrorMessage`

**`toErrorMessage(e: unknown): string`**

Stringify an unknown error for display (`e instanceof Error ? e.message : String(e)`). Used across core for error events.

```ts
import { toErrorMessage } from "@vietor/agent-core/util";

toErrorMessage(new Error("boom"));   // "boom"
toErrorMessage("oops");              // "oops"
```

## Subprocess

### `runProcess`

**`runProcess(cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }, signal?: AbortSignal): Promise<ProcessResult>`**

Run a subprocess, capturing stdout and stderr (used by the built-in Shell tool). The promise never rejects — spawn failures, timeouts, and output over the 10MB cap are reported via `ProcessResult.error`. Pass a `timeout` (ms) or an `AbortSignal` to kill the process tree. Live processes are killed on process exit.

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

### `findCommands`

**`findCommands(commands: string[]): string[]`**

Return the subset of commands that exist on the PATH (uses `where` on Windows, `command -v` elsewhere). Useful for picking an available interpreter, e.g. `node` vs `bun`.

```ts
import { findCommands } from "@vietor/agent-core/util";

findCommands(["python", "python3"]);   // e.g. ["python"]
```

## File

### `tryReadFileText`

**`tryReadFileText(path: string): string | undefined`**

Read a text file, returning `undefined` on any failure (missing file, empty content, read error).

```ts
const content = tryReadFileText("./config.json");
if (content) {
  const config = JSON.parse(content);
}
```

## HTML

### `htmlToMarkdown`

**`htmlToMarkdown(html: string): string`**

Convert HTML to Markdown using [Turndown](https://github.com/mixmark-io/turndown). Strips script, style, title, meta, head, noscript, template, link, and base elements.

```ts
import { htmlToMarkdown } from "@vietor/agent-core/util";

const md = htmlToMarkdown("<h1>Hello</h1><p>World</p>");
// "# Hello\n\nWorld"
```

## Network

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

## Constants

Tool-call timeouts, empty results, and text caps share constants here:

| Constant | Value | Meaning |
|---|---|---|
| `CALL_TIMEOUT_MS` | `300_000` | Default tool-call timeout (Shell, MCP tools) |
| `NO_OUTPUT` | `"(no output)"` | Content placeholder for empty tool results |
| `MAX_SUMMARY_LENGTH` | `75` | Default length cap for `summarizeText` |
