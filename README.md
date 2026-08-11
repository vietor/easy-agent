# Easy Agent

![](https://img.shields.io/badge/Node.js-22%2B-brightgreen?style=flat-square) [![core]](https://www.npmjs.com/package/@vietor/easy-agent-core) [![cli]](https://www.npmjs.com/package/@vietor/easy-agent)

[core]: https://img.shields.io/npm/v/@vietor/easy-agent-core.svg?style=flat-square&label=core
[cli]: https://img.shields.io/npm/v/@vietor/easy-agent.svg?style=flat-square&label=cli

An autonomous coding agent in the terminal — monorepo workspace.

## Features

- **Multi-backend LLM client** — pluggable wire protocol that supports OpenAI Chat Completions (`"completions"`), Anthropic Messages API (`"anthropic"`), and OpenAI Responses API (`"responses"`) backends.
- **Reasoning effort** — configure `reasoningEffort` (`high` / `max`) to control reasoning depth; displayed live in the TUI header.
- **MCP (Model Context Protocol)** — connect stdio or Streamable HTTP MCP servers for external tools; connection status and tool list visible via `/mcp`.
- **Session persistence** — save/resume conversations with async `SessionPersistence` and `flush()` write-completion guarantees; CLI supports `--continue` / `--resume`.
- **Built-in tool system** — FileRead/Glob/Grep/WebFetch (read-only) plus Shell/FileWrite/Edit enabled by default; interactive tools AskUser, TodoWrite, and SubAgent (nested read-only explore/plan sub-agents) opt in via `builtinTools`, and Skill auto-registers when skills are loaded; `{ readOnly: true }` limits the session to read-only tools, `false` disables all — plus a simple `Tool` interface for custom tools.
- **Skill system** — `SKILL.md` files in `~/.easy-agent/skills/` register as slash commands automatically, and the agent can invoke them itself via the built-in Skill tool.
- **Context compaction** — auto-triggered LLM summarization when the conversation nears the token limit; also available as `/compact`.
- **Stall & turn limits** — detects repeated identical tool calls or text-only responses while todos are incomplete (`stallThreshold`) and caps agent loop iterations (`maxTurns`), configurable per session.
- **Transient error retry** — automatic retry of transient API failures (timeouts, rate limits, empty responses) and flaky WebFetch requests, with attempts surfaced via `retry` events.
- **Reentrancy protection** — `SessionBusyError` guards against concurrent `startPrompt`/`compact` calls.
- **Token usage tracking** — per-run `inputTokens` / `outputTokens` counters displayed in the TUI and exposed via events.

This repo contains two packages:

| Package | npm | Description |
|---------|-----|-------------|
| [`@vietor/easy-agent`](./packages/cli/README.md) | CLI | Terminal TUI app (Ink/React) |
| [`@vietor/easy-agent-core`](./packages/core/README.md) | Library | SDK framework for building AI agents |

## Development

### Prerequisites

- [pnpm](https://pnpm.io/) — workspace package manager
- Node.js ≥ 22

### Setup

```bash
git clone https://github.com/vietor/easy-agent.git
cd easy-agent

pnpm install           # install all dependencies
pnpm build             # build core → CLI in order
pnpm --filter @vietor/easy-agent dev   # run TUI in dev mode (tsx hot-reload)
```

### Project Structure

```
easy-agent/
├── packages/
│   ├── core/          # @vietor/easy-agent-core — SDK framework (library)
│   │   └── src/
│   │       ├── core/                # Agent, Session, Conversation, Timeline
│   │       ├── tools/               # built-in tools (Shell, File*, Grep, Glob, WebFetch…)
│   │       ├── llm/                 # LLM client — pluggable backends (OpenAI Chat Completions + Responses API + Anthropic Messages API)
│   │       ├── mcp/                 # MCP client/server (stdio + Streamable HTTP)
│   │       ├── skills/              # skill loader (SKILL.md files)
│   │       ├── util/                # netFetch (proxy-aware fetch), ripgrep, subprocess…
│   │       ├── create-session.ts    # createSession() factory
│   │       └── index.ts             # public API exports
│   └── cli/           # @vietor/easy-agent — CLI application (Ink/React TUI)
│       └── src/
│           ├── tui/                 # terminal UI (app, timeline-view, todo-view, etc.)
│           │   └── components/      # shared UI components (Markdown renderer…)
│           ├── commands/            # built-in slash commands + dispatcher
│           ├── util/                # package info, FileSessionPersistence
│           ├── config.ts            # JSON config loader (~/.easy-agent.json)
│           └── main.ts              # bin entry (shebang) — parses args, wires session, starts TUI
├── package.json       # workspace root (private)
├── pnpm-workspace.yaml
└── tsconfig.json      # base TypeScript config
```

The `core` package contains the framework logic (agent loop, tools, MCP client/server, skill system), an event-driven interface (`StreamEvent` / `subscribeEvents`), and async `SessionPersistence` for save/resume with `flush()` for write-completion guarantees. The `cli` package depends on `core` and provides the interactive terminal experience with session persistence (`--continue`/`--resume`) plus its own built-in slash commands and dispatcher.

### Build order

Always build `core` first, then `cli`, because CLI depends on core:

```bash
pnpm --filter @vietor/easy-agent-core build
pnpm --filter @vietor/easy-agent build
```

Or simply `pnpm build` which runs both in order.

### Testing

```bash
pnpm test     # run the core test suite (Node's built-in test runner)
```

## Publishing

Both packages are published to npmjs under the `@vietor` scope.

> **Important**: always publish `core` first, then `cli`.

```bash
# Make sure you're logged in to npmjs
pnpm login

# 1. Publish the core library
pnpm publish --filter @vietor/easy-agent-core

# 2. Publish the CLI (pnpm auto-replaces workspace:* with the published version)
pnpm publish --filter @vietor/easy-agent
```

### Before publishing

- Bump versions: `pnpm version patch --filter @vietor/easy-agent-core && pnpm version patch --filter @vietor/easy-agent` (or `minor`/`major`)
- Run `pnpm build` to ensure clean dist output
- Run `pnpm publish --filter <package> --dry-run` to preview the package contents
