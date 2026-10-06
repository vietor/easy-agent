# @vietor/example-terminal-embed

A minimal host for `@vietor/agent-core`: a plain Node terminal loop built from nothing but `node:` built-ins and the core package — no CLI, no TUI framework, no Ink. It exercises the contract in [`packages/core/INTEGRATION.md`](../../packages/core/INTEGRATION.md) end to end.

## What it demonstrates

- `createSession` with an env-driven `LLMConfig`, `builtInTools: { askUser: true, todoWrite: true }`, and optional persistence (`EASY_AGENT_SESSION_DIR`).
- Rendering the event stream: assistant/thinking deltas, tool lines, `todos_changed`, errors, and a per-run token/elapsed line from `run_metrics`.
- Answering AskUser questions from the same readline input: option numbers, `1,3` for multi-select, `1;2,3` for several questions, empty line to skip.
- Ctrl+C: aborts the run while one is in progress, otherwise saves and disposes the session before exiting.

Deliberately not covered (see INTEGRATION.md for each): snapshot rendering via `subscribe`/`getSnapshot`, sub-agent event routing, MCP servers, custom tools, and input editing while a run streams.

## Run

```bash
pnpm install
pnpm build
EASY_AGENT_BASE_URL=https://api.anthropic.com \
EASY_AGENT_API_KEY=sk-... \
EASY_AGENT_MODEL=your-model \
EASY_AGENT_BACKEND=anthropic \
pnpm --filter @vietor/example-terminal-embed start
```

`pnpm typecheck` (from this directory, or `pnpm --filter @vietor/example-terminal-embed typecheck` from the repo root) checks the example against core's published `exports` types — the same surface an external consumer resolves.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `EASY_AGENT_BASE_URL` | yes | LLM endpoint base URL |
| `EASY_AGENT_API_KEY` | yes | API key for the endpoint |
| `EASY_AGENT_MODEL` | yes | Model name |
| `EASY_AGENT_BACKEND` | no | `completions` (default), `anthropic`, or `responses` |
| `EASY_AGENT_SESSION_DIR` | no | Persist under this directory. The session is constructed with a fixed `sessionId` of `demo`, so a restart resumes the previous conversation; the scratch dir lives in `<dir>/scratch` |

Without `EASY_AGENT_SESSION_DIR` the session is in-memory only: nothing is saved and each start is a fresh conversation.
