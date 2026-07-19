# Easy Agent

![](https://img.shields.io/badge/Node.js-22%2B-brightgreen?style=flat-square) [![core]](https://www.npmjs.com/package/@vietor/easy-agent-core) [![cli]](https://www.npmjs.com/package/@vietor/easy-agent)

[core]: https://img.shields.io/npm/v/@vietor/easy-agent-core.svg?style=flat-square&label=core
[cli]: https://img.shields.io/npm/v/@vietor/easy-agent.svg?style=flat-square&label=cli

An autonomous coding agent in the terminal — monorepo workspace.

## Features

- **Reasoning effort** — configure `reasoningEffort` (`high` / `max`) in the LLM config to control the depth of model reasoning; defaults to `high`. The current setting is displayed in the TUI header.

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
│   │       ├── core/                # Agent, Session, RunLoop, Conversation, Timeline
│   │       ├── tools/               # built-in tools (Shell, File*, Grep, Glob, WebFetch…)
│   │       ├── cmds/                # command system (registry, built-in slash commands)
│   │       ├── llm/                 # OpenAI-compatible LLM client
│   │       ├── mcp/                 # MCP client/server (stdio + Streamable HTTP)
│   │       ├── skills/              # skill loader (SKILL.md → slash commands)
│   │       ├── util/                # netFetch (proxy-aware fetch), ripgrep, subprocess…
│   │       ├── sessionBuilder.ts    # createSession() factory
│   │       └── index.ts             # public API exports
│   └── cli/           # @vietor/easy-agent — CLI application (Ink/React TUI)
│       └── src/
│           ├── tui/                 # terminal UI (App, TimelineView, TodoView, etc.)
│           │   └── components/      # shared UI components (Markdown renderer…)
│           ├── cmds/                # CLI-specific built-in commands
│           ├── util/                # format, package info, FileSessionPersistence
│           ├── config.ts            # JSON config loader (~/.easy-agent.json)
│           └── cli.ts               # entry — parses args, wires session, starts TUI
├── package.json       # workspace root (private)
├── pnpm-workspace.yaml
└── tsconfig.json      # base TypeScript config
```

The `core` package contains the framework logic (agent loop, tools, MCP client/server, command/skill systems), an event-driven interface (`SessionEvent` / `subscribeEvents`), and async `SessionPersistence` for save/resume with `flush()` for write-completion guarantees. The `cli` package depends on `core` and provides the interactive terminal experience with session persistence (`--continue`/`--resume`) and a built-in skill registry for slash commands.

### Build order

Always build `core` first, then `cli`, because CLI depends on core:

```bash
pnpm --filter @vietor/easy-agent-core build
pnpm --filter @vietor/easy-agent build
```

Or simply `pnpm build` which runs both in order.

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
