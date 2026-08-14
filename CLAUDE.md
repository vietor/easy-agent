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

- `core/src/runtime/` — `Session` (orchestration), `Agent` (run loop), `SessionMessages`, `Timeline`, `sub-agent-runner`, `prompts`, `events.ts`, `persistence.ts`
- `core/src/tools/` — built-in tools (one file each) + `registry.ts` (registry, schemas, summaries, registration)
- `core/src/llm/` — `types.ts` (shared `LLMClient` interface), `messages.ts` (message family), `client.ts`, `base.ts`, `anthropic.ts`, `responses.ts`, `completions.ts` (wire backends)
- `core/src/mcp/` — `manager.ts` (client-side server manager) + `client.ts` (single-server client) for stdio + Streamable HTTP
- `core/src/skills/`, `core/src/util/` — loader; shared helpers (`async.ts`, `file.ts`, `text.ts`, `constants.ts`, `emitter.ts`)
- `core/src/create-session.ts`, `core/src/index.ts` — factory; public API re-exports (`@vietor/agent-core` root + `@vietor/agent-core/util` subpath via `util/index.ts`)
- `cli/src/` — `index.ts`, `main.ts`, `config.ts`, `session-persistence.ts`, `commands/`, `tui/`

## Code Style (no linter/prettier config — conventions only)

- 2-space indent, single quotes, semicolons, trailing commas on multiline, ~120 cols.
- **Named exports only** — never `export default`.
- ESM with NodeNext: relative imports end in `.js`; `import type { ... }` for type-only imports.
- Classes only for stateful objects; plain functions for stateless logic.
- **Never add comments.** New or edited code ships without comments — do not introduce or re-add them when touching existing code. Keep only the rare existing JSDoc `/** */` on non-obvious exports and inline *why*-rationale comments; don't extend them, don't restate what the code does, no section banners, no `// TODO`, no credits.
- Errors: stringify unknown errors via the shared error helper in `util/text.ts` — never `e instanceof Error ? e.message : String(e)` inline.
- **Prefer reusing `util/*.ts` helpers** — check `async.ts` (abort/retry/timeout), `file.ts` (path resolution, file IO), `text.ts` (formatting, summaries, truncation marker), `constants.ts` (byte caps, tool names) before writing new code; add a new util helper only when none of the existing ones fits.
- Callbacks invoked with optional chaining.
- Naming: kebab-case files, PascalCase classes/types, camelCase functions, SCREAMING_SNAKE constants.

## Testing

- Node's built-in runner: `node --import tsx --test`, assertions from `node:assert/strict`.
- Files: `packages/core/test/*.test.ts`, shared helpers in `test/helpers.ts`.
- The `test` script in `packages/core/package.json` is a glob (`test/*.test.ts`), expanded by the Node 22 test runner — new test files are picked up automatically.
- Established patterns: scripted LLM responses, tool-call message builders, agent factories. New tests should reuse these.

## Settled Design Decisions — Do Not Revert

These came out of deliberate refactors; treat as final unless the user explicitly asks to revisit:

- **A single session class is the orchestration unit** — run state and timeline replay are single-sourced. Don't re-extract a run-loop class.
- **One shared LLM client interface** covering both Anthropic and OpenAI backends; backend-specific shapes stay in their own files.
- **No validation libraries** — plain TS types, hand-written checks where needed (e.g. tool args must parse to a plain object).
- **A single registration point for built-in tools**; it accepts `false` to disable all builtins, and options flags to opt into optional ones.
- **Shared helpers have single homes**: file IO/path resolution in `util/file.ts`, string/format in `util/text.ts`, byte caps in `util/constants.ts`, abort/retry in `util/async.ts`. Don't duplicate or move them.
- **`AgentEvent` is a single union; every variant carries a `persisted: true/false` literal**, and `TimelineEvent = Extract<AgentEvent, { persisted: true }>` is the persisted subset. Multi-word type tags are snake_case (`assistant_delta`, `thinking_delta`, `thinking_cleared`, `tool_start`, `tool_end`, `run_metrics`); persisted variants are single-word (`user`, `skill`, `assistant`, `tool`, `retry`, `error`, `interrupted`, `question`, `notice`). No terminal `thinking` event exists — consumers accumulate `thinking_delta` until `thinking_cleared`.
- **Util names must match behavior**: `countNonEmptyLines` counts non-empty lines, `summarizeText` collapses whitespace and truncates with `…`, `withTimeoutFn` is the function variant of `withTimeout`. Don't rename these back to misleading names (`countLines`, `truncateText`, `withTimeoutError`).
- **Todo status glyphs live in consumers** (CLI), not in core types.
- **Dead code is removed, not kept** — don't resurrect deleted code paths.

## Change Conventions

- Conventional Commits with optional scope: `feat(core):`, `fix(core):`, `refactor(core):`, `chore(core):`, `feat(cli):`, e.g. `refactor(core): move resolvePath into util/file.ts`.
- Optimization passes should minimize diff: no reformatting of untouched lines, no comment re-adding, no re-extraction of consolidated code.
- After core changes, run `pnpm test`; build core before cli.
