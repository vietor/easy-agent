# Easy Agent — Project Conventions

Monorepo (pnpm workspace) for a terminal AI coding agent. Node.js >= 22, TypeScript strict, ESM (`"type": "module"`). This file records the current style and settled design decisions so optimization passes converge instead of churning.

## Packages & Commands

| Package | Role |
|---|---|
| `packages/core` (`@vietor/agent-core`) | Framework library: agent loop, session, tools, MCP, skills, LLM clients |
| `packages/cli` (`@vietor/easy-agent`) | Ink/React TUI CLI; depends on core via `workspace:*` |

```bash
pnpm test                    # core test suite
pnpm build                   # build core, then cli (order matters)
pnpm --filter @vietor/easy-agent dev   # TUI dev mode (tsx)
```

## Layout

- `core/src/runtime/` — `Session` (orchestration), `Agent` (run loop), `SessionMessages`, `Timeline`, `sub-agent-runner`, `prompts`, `events.ts`
- `core/src/tools/` — built-in tools (one file each) + `registry.ts` (registry, schemas, summaries, registration) + `types.ts` (tool types, `toolError`, the zod arg helpers)
- `core/src/llm/` — `types.ts` (shared `LLMClient` interface), `messages.ts` (message family), `client.ts`, `base.ts`, `anthropic.ts`, `openai.ts` (wire backends)
- `core/src/mcp/` — `manager.ts` (client-side server manager) + `client.ts` (single-server client) for stdio + Streamable HTTP
- `core/src/skills/`, `core/src/util/` — loader; shared helpers (`async.ts`, `file.ts`, `text.ts`, `constants.ts`, `emitter.ts`)
- `core/src/create-session.ts`, `core/src/index.ts` — factory; public API re-exports (`@vietor/agent-core` root + `@vietor/agent-core/util` subpath via `util/index.ts`)
- `cli/src/` — `index.ts`, `main.ts`, `config.ts`, `session-resolution.ts`, `commands/`, `tui/`

## Code Style (no linter/prettier config — conventions only)

- 2-space indent, single quotes, semicolons, trailing commas on multiline.
- **Named exports only** — never `export default`.
- ESM with NodeNext: relative imports end in `.js`; `import type { ... }` for type-only imports.
- Classes only for stateful objects; plain functions for stateless logic.
- **Never add comments.** New or edited code ships without comments — do not introduce or re-add them when touching existing code. Keep only the rare existing JSDoc `/** */` on non-obvious exports and inline *why*-rationale comments; don't extend them, don't restate what the code does, no section banners, no `// TODO`, no credits.
- Naming: kebab-case files, PascalCase classes/types, camelCase functions, SCREAMING_SNAKE constants.

## Testing

- Node's built-in runner: `node --import tsx --test`, assertions from `node:assert/strict`.
- Files: `packages/core/test/*.test.ts`, shared helpers in `test/helpers.ts`.
- The `test` script in `packages/core/package.json` is a glob (`test/*.test.ts`), expanded by the Node 22 test runner — new test files are picked up automatically.
- Established patterns: scripted LLM responses, tool-call message builders, agent factories. New tests should reuse these.

## Settled Design Decisions — Do Not Revert

These came out of deliberate refactors; treat as final unless the user explicitly asks to revisit:

- **A single session class is the orchestration unit** — run state and timeline replay are single-sourced. Don't re-extract a run-loop class.
- **One shared LLM client interface** covering both Anthropic and OpenAI backends; backend-specific shapes stay in their own files. `SessionOptions.llm` accepts either an `LLMConfig` or an injected `LLMClient` (`isLLMClient` discriminates on `chat`); an injected client is used as-is — no schema, no retry stack — so its `maxInputTokens`/`maxOutputTokens` drive `contextLimit` and retries are the injector's responsibility.
- **One zod schema per tool is the single source for both the provider payload and runtime validation** — `parameters` comes from `toToolParameters(schema)` (`z.toJSONSchema` with `io: "input"` and `target: "openapi-3.0"`, so no `$schema` and no `additionalProperties` leak onto the wire) and tools validate with `parseToolArgs`/`tryParseToolArgs` from `tools/types.ts`. Don't confuse the latter with `parseToolCallArgs` in `llm/messages.ts`, which only turns a tool call's `arguments` JSON string into a plain object. Only the deliberate normalizations survive: TodoWrite's single-`inProgress` rewrites and AskUser's trim/dedupe/header truncation. Config uses the same pattern (`LLMConfigSchema`, `MCPServerConfigSchema`). MCP tools are the exception — their `parameters` is the remote server's raw JSON Schema and has no zod schema.
- **A single registration point for built-in tools**; it accepts `false` to disable all builtins, and options flags to opt into optional ones.
- **A turn's tool calls are batched by concurrency safety, not run flat** — `Tool.concurrencySafe` is fail-closed (absent means serial), and `Agent.runToolCalls` splits a turn into consecutive runs: a run of safe calls executes together up to `maxParallelToolCalls`, every other call runs alone. This is what makes two concurrent `Edit`s on one file safe — there is no per-file lock and adding one is not the fix. Sub-agent fan-out is capped by a plain per-session counter (`SubAgentBudget`, default 4) that holds a slot for a whole sub-agent run: **the session's own (depth-1) calls beyond the budget wait in FIFO and run in the same turn, while nested calls (depth ≥ 2) are refused with a tool error** — a parent run holds its slot while awaiting its children, so a blocking acquire at depth ≥ 2 would deadlock the tree. Once a depth-1 sub-agent ends with a status other than `ok`, the calls still waiting are skipped with a `(not executed: …)` error result rather than started. Don't turn the depth-2 refusal into a wait, don't turn the failure skip into a wait-for-the-whole-wave, and don't "fix" the serialization of writes.
- **Shared helpers have single homes**: file IO/path resolution in `util/file.ts`, string/format in `util/text.ts`, byte caps in `util/constants.ts`, abort/retry in `util/async.ts`. Don't duplicate or move them.
- **`SessionEvent` (delivered by `onEvent`) is the union of two standalone types** — `TimelineEvent` (timeline entries: `user`, `skill`, `assistant`, `tool`, `retry`, `error`, `interrupted`, `question`, `notice`) and `StreamEvent` (transient: `assistant_delta`, `thinking_delta`, `thinking_cleared`, `tool_start`, `tool_end`, `todos_changed`, `mcp_changed`, `sub_agent_event`, `run_metrics`) — defined independently, with no `persisted` flags and no `Extract` derivation. Timeline entry tags are single-word; stream tags are snake_case. No terminal `thinking` event exists — consumers accumulate `thinking_delta` until `thinking_cleared`. `todos_changed` (every todo mutation pushes the new list; `Session.setTodos` is the single emit point), `mcp_changed` (one emit from `Session.connectMCP` after the connections settle, since the tool registry and `contextTokens` may have changed) and `sub_agent_event` (a running sub-agent's own events wrapped with the parent tool-call id threaded via `ToolContext.toolCallId`; emitted through `Session.emit`, never `handleEvent`, so nested streams stay out of the parent's stream buffer, and nested delegations share the tree's top-level id) are deliberate host-facing extensions. All three are stream-only — `TimelineStore.applyEvent` ignores them on purpose, as do the stream tags above.
- **Util names must match behavior**: `countNonEmptyLines` counts non-empty lines, `summarizeText` collapses whitespace and truncates with `…`, `withTimeoutFn` is the function variant of `withTimeout`. Don't rename these back to misleading names (`countLines`, `truncateText`, `withTimeoutError`).
- **Todo status glyphs live in consumers** (CLI), not in core types.
- **Dead code is removed, not kept** — don't resurrect deleted code paths.
- **Session persistence is split by concern, not by layer** — core owns everything that touches the session files when `sessionDir` is set: the JSONL format, the writer (`session-persistence.ts` — every save rewrites the whole file atomically, skipping unchanged content), auto-save at run boundaries plus `clear()`, reading, listing, and sweeping (`createSession` sweeps `sessionDir` and clears `scratchDir` at construction, since scratch files never carry over into a new session). It exposes `save()`, `isSessionExists()`, `isSessionFile()`, and `listSessions()` — a session resumes its own file at construction, the CLI's `--import` seeds a new session from another file's content (`importPath` — messages and todos only, no copy), and the state is never handed around as an object (`exportState()`/`importState()` are internal). The CLI only computes the directories (`~/.easy-agent/sessions/<encodedCwd>` and `~/.easy-agent/scratch/<encodedCwd>`), resolves `--resume`/`--import`, and prints the session list. Don't move the directory layout into core, and don't add a storage *backend* abstraction (pluggable stores, adapters) — `sessionDir` is the whole extension point.
- **Tool images ride a side-channel `images?: ImagePart[]` field, never content parts** — a tool message/result keeps its string `content` and may carry base64 `ImagePart`s next to it, so every string-based path (events, summaries, truncation, timeline) is untouched and base64 never enters the event stream. Backends lower it natively: Anthropic puts image blocks inside `tool_result.content` (image before text), Completions always rebuilds tool messages and flushes accumulated images as one injected user message after a run of consecutive tool messages (tool role can't carry images), Responses uses `function_call_output.output` arrays with `detail: "auto"` (required by the installed SDK type). Tokens are estimated from each image's parsed header dimensions via `estimateImageTokens` in `util/file.ts` (`(w×h)/750` after scaling the longest edge to 1568 — one backend-agnostic magnitude, not a per-backend exact count), falling back to the flat `IMAGE_TOKEN_ESTIMATE` when the header can't be parsed; `pruneToolOutputs` clears `images` together with the content so the freed-token arithmetic stays exact; images serialize inline in the session JSONL. `LLMConfig.vision` (default true, surfaced as `ToolContext.vision`) is a **tool-side hint for text-only endpoints** — with `vision: false`, Read returns a description without image data — not a wire filter: pre-existing images in a resumed session or from custom tools still go to the backend. Don't turn it into a filter, don't replace the header-dimension estimate with per-backend formulas, and don't give `LLMClient.vision` a default (absent means capable — injected clients and test doubles must keep compiling).
- **Core is the turnkey integration framework; CLI is the product shell** — `createSession`, the built-in toolset (file/shell/web/ask-user/todo/sub-agent/skill), the skills loader, prompts, and shared utils are the framework's integration surface for external consumers and stay in core. The CLI holds only process lifecycle, TUI, config, and command dispatch. Don't propose further core→cli moves.
- **The CLI passes its own client identity** — `createSession`'s `clientInfo` is set from the CLI's package name/version so MCP servers identify `easy-agent`, not the framework default.

## Change Conventions

- Conventional Commits with optional scope: `feat(core):`, `fix(core):`, `refactor(core):`, `chore(core):`, `feat(cli):`, e.g. `refactor(core): move resolvePath into util/file.ts`.
- Optimization passes should minimize diff: no reformatting of untouched lines, no comment re-adding, no re-extraction of consolidated code.
- After core changes, run `pnpm test`; build core before cli.
