# Integration Contract

How to embed `@vietor/agent-core` in your own terminal tool. The [README](./README.md) is the API reference; this document is the contract between what core guarantees and what the host must do — for a host that owns the terminal (rendering, key handling, dialogs) and drives the session in-process, with no dependency on this repository's CLI.

The embedded example in `examples/terminal-embed` follows this contract with nothing but `node:` and this package — rendering, questions, interrupts, and persistence; its README lists what it deliberately leaves out.

## 1. Division of responsibility

| Core owns | Host owns |
|---|---|
| The agent loop: LLM calls, retries, tool batching/execution, auto-compaction, stall/turn limits | Rendering: terminal output, input editing, dialogs, status lines |
| Session state: timeline, todos, pending questions | Process lifecycle: signal handling, exit codes, resume/import UX |
| Persistence *format* and file IO under `sessionDir` | Choosing the directories and the `sessionId` (`~/.easy-agent/sessions/...` in the CLI) |
| Event semantics: ordering, payloads, pending states (`result: null`, `answer: null`) | Consuming the event stream and the snapshot |
| System-prompt assembly, MCP client, tool execution | Answering questions (`submitAnswer`) and abort wiring |
| The built-in tools | Registering custom tools, skills, and MCP servers |

Core assumes no terminal, no console, and no stdin: it never prints. Everything observable flows through `onEvent`, `subscribe`/`getSnapshot`, and the getters.

## 2. Rendering the event stream

`session.onEvent(listener)` is the incremental stream; `session.subscribe` + `session.getSnapshot()` is the coalesced view (`{ timeline, todos }`, designed for `useSyncExternalStore`). Recommended shape:

- Render **timeline state** (entries, todos, question answers) from `getSnapshot()`, re-read on every `subscribe` invalidation.
- Render **live text** from stream events: append `assistant_delta` to the current reply; append `thinking_delta` to a thinking buffer and clear it on `thinking_cleared`. There is no terminal `thinking` event — accumulate until cleared.
- `tool_start` opens a tool row keyed by `id` (name + `argsSummary`); `tool_end` merges the result, `isError`, and `resultSummary` into the row with the same `id`. A run that ends before `tool_end` leaves the timeline entry with `result: "(interrupted)"`.
- `run_metrics` fires at run start, every second while running, and once at run end with `running: false` — use it for the spinner and the token/elapsed status line.
- `todos_changed` carries the new list; it is redundant with `getSnapshot().todos` for snapshot-driven hosts and sufficient on its own for stream-driven ones.
- `error` events are for display; the run's failure also surfaces as `PromptResult.status`/`error` after `await`.

Switch exhaustively on `event.type` (no `default`): the union is additive over releases, and a compile error on upgrade is the intended way to learn about new event tags. `sub_agent_event` is self-similar — its `event` field is the same `SessionEvent` union, so nested streams can reuse the same renderer.

Sub-agents: route `sub_agent_event` by `toolCallId`, keyed from the SubAgent `tool_start.id`. Nested delegations are tagged with the id of the session-level call that began the tree. Nested streams have no `thinking_cleared` — drop accumulated nested thinking on the next nested `assistant_delta`, `tool_start`, or `error`, or when the parent delegation's `tool_end` arrives.

## 3. Answering questions

The built-in **AskUser** tool emits a `question` timeline entry (also an event) and *suspends the run until the host answers* — if nobody answers, `await session.prompt(...)` never resolves (until `abort()`).

```ts
{ type: "question", id: "q1", questions: [{ question: "...", options: [...], multiSelect: false, answer: null }] }
```

- Answer with `session.submitAnswer(id, answers)`, positionally matched to `questions`: `string` (selected label) for single-select, `string[]` for multi-select, `""` to skip. Custom text the user typed stands in for a label.
- `session.pendingQuestion` returns the most recent unanswered group — for renderers attaching to a session mid-question. Answered state lives on the timeline entry (`answer` is replaced, `null` → value), so `subscribe` invalidation re-renders it.
- `abort()` (and `dispose()`) resolves every pending question with all-`""` answers and stops the run — always the fallback when the user cancels the dialog.

## 4. Interrupting a run

`session.abort()` is synchronous and safe to call from a signal handler; it aborts the in-flight LLM call and tool batch and dismisses pending questions. The run then settles:

- `PromptResult.status === "aborted"`; `reply` holds whatever assistant text had streamed;
- the timeline gains an `interrupted` entry, and open tool rows get the `(interrupted)` result;
- `run_metrics` fires once more with `running: false`.

Pattern for Ctrl+C: if `session.running`, call `abort()` and let the loop settle; on the next signal (or after the awaited `prompt` returns) exit.

```ts
process.on("SIGINT", async () => {
  if (session.running) return session.abort();
  await session.save();
  session.dispose();
  process.exit(0);
});
```

## 5. Shutdown, saving, and resuming

- `dispose()` kills MCP server processes; call it before exit. With no MCP servers it is still the supported teardown call.
- With `sessionDir` set, core saves automatically at every run boundary (awaited — the file is on disk before `prompt()` resolves) and on `clear()`. `await session.save()` is a cheap belt-and-braces flush for paths that skip a run. Without `sessionDir`, `save()` resolves immediately and nothing is written.
- Resuming is construction: build the session with the same `sessionId` and `sessionDir` and its file is loaded; `importPath` instead seeds a new session from another file's content (messages and todos only). The CLI's `--resume`/`--import` are exactly this — see the README's `SessionState` section for the file semantics (`session.filePath` exposes the path).

## 6. One run at a time

`prompt`, `compact`, `runSkill`, and `clear` throw `SessionBusyError` while a run is in progress. `abort`, `submitAnswer`, `save`, `dispose`, `onEvent`, `subscribe`, `getSnapshot`, and the getters remain callable. Core deliberately does not queue: queueing prompts, coalescing them, or rejecting input with a "busy" hint is host policy — check `session.running` before driving, or catch `SessionBusyError` and wait for the `run_metrics` `running: false` event.

## 7. MCP readiness

`createSession` connects `mcpServers` in the background — it returns before they are up, and a server's tools appear to the model once it connects (the tool list is rebuilt per turn). `session.mcpServers` reports each server's `pending`/`connected`/`failed` state with an `error` message on failure; a failed server never fails the session.

If your UI wants a server ready before the first prompt, `await session.connectMCP(servers)` yourself (then don't also pass `mcpServers`). `connectMCP` is also the runtime "add servers" API.

## 8. Custom tools

A `Tool` is a plain object: one zod schema is the single source for both the wire schema and runtime validation.

```ts
import { toToolParameters, toolError, tryParseToolArgs, z, type Tool } from "@vietor/agent-core";

const Args = z.object({ name: z.string().min(1) });

const greetTool: Tool = {
  name: "greet",
  description: "Greet someone by name",
  parameters: toToolParameters(Args),
  async execute(args) {
    const parsed = tryParseToolArgs(Args, args);
    if (!parsed.ok) return toolError(parsed.error);
    return { content: `Hello, ${parsed.value.name}!` };
  },
};
```

- Register via `tools: [greetTool]` on `createSession`. A tool whose `name` matches a built-in replaces it (custom tools register after built-ins) — the supported override path.
- `concurrencySafe` is fail-closed: absent means the tool runs alone, serialized against everything else in its turn. Opt in only for tools that read without mutating state.
- `agentLevel` (`0`/`1`/`2`) controls sub-agent grants: level 1 reaches read-only sub-agents, level 2 the writable "general" type; absent means never delegated.
- `argSummaryKeys`/`summarizeArgs` shape the one-line `tool_start` summary; `summarizeResult` the completed row.
- MCP tools are the exception to the zod rule — their `parameters` is the remote server's raw JSON Schema, and they run under the same concurrency-safe/agent-level defaults (`false`/`0`).

## 9. Custom LLM clients

See the README's **Custom LLM clients** section for the full contract. The essentials: an injected `LLMClient` is used as-is (no validation), its `maxInputTokens`/`maxOutputTokens` must be truthful because `session.contextLimit` derives from them, and retries/timeouts are the client's responsibility — reuse core's stack with `withRetryChat` when implementing the `LLMAdapter` shape.

## 10. Integration checklist

| The host must… | Mechanism |
|---|---|
| Render streaming output | `onEvent`: `assistant_delta` / `thinking_delta` until `thinking_cleared` |
| Render conversation state | `getSnapshot()` + `subscribe` invalidation |
| Show tool activity | `tool_start` opens by `id`, `tool_end` merges |
| Render sub-agent activity | `sub_agent_event` routed by `toolCallId` |
| Keep the todos view current | `todos_changed` or `getSnapshot().todos` |
| Answer AskUser | `submitAnswer(id, answers)`; `pendingQuestion` for late attach; `abort()` clears |
| Interrupt a run | `abort()` when `session.running` |
| Show progress/tokens | `run_metrics` (start, 1s cadence, final) |
| Survive busy sessions | Check `session.running` / catch `SessionBusyError`; queueing is host policy |
| Shut down cleanly | `await save()` (when desired) + `dispose()` |
| Resume a session | Construct with the same `sessionId` + `sessionDir`, or seed with `importPath` |
| Know when MCP is ready | `mcp_changed`, `session.mcpServers`, or `await connectMCP` yourself |
