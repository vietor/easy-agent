# @vietor/easy-agent

Terminal-based AI agent CLI with a conversational TUI, powered by `@vietor/easy-agent-core`.

## Requirements

- Node.js ≥ 22

## Install

Install globally:

```bash
npm install -g @vietor/easy-agent
```

Or run it once without installing:

```bash
npx @vietor/easy-agent
```

## Configuration

Create `~/.easy-agent.json` in your home directory:

```json
{
  "llm": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "your-api-key",
    "model": "deepseek-v4-flash"
  }
}
```

`llm.baseUrl`, `llm.apiKey`, and `llm.model` are all required. Point `baseUrl` at any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, local servers, etc.) and set `model` to a model that endpoint serves.

### Proxy

The agent automatically routes HTTP requests through a proxy when the standard environment variables are set:

- `HTTPS_PROXY` / `https_proxy` — proxy URL for HTTPS (preferred)
- `HTTP_PROXY` / `http_proxy` — proxy URL for HTTP (fallback)
- `NO_PROXY` / `no_proxy` — comma-separated hosts/domains to bypass the proxy

No extra configuration is needed — just set the env vars before launching `easy-agent`.

### MCP servers (optional)

Add an `mcpServers` map to expose external tools through the Model Context Protocol. Each entry is either a local process (stdio) or a remote endpoint (Streamable HTTP):

```json
{
  "llm": { ... },
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp@latest", "--auto-connect", "--accept-insecure-certs"]
    },
    "api-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

A stdio server omits `type` (or sets `"stdio"`); only `command` is required, `args` and `env` are optional. A remote server sets `type` to `"http"` with a required `url`; `headers` is optional and sent with every request (use it for static auth tokens). Either entry accepts an optional `enabled` (defaults to `true`); set `false` to keep a server configured but skip starting it. MCP tools become available to the agent as `MCP__<server>__<tool>`. If a server fails to connect within 30s, it is disabled and the error is shown in the TUI — for stdio servers the captured stderr tail is included to help diagnose startup failures — and the rest keep running.

### Agent instructions (optional)

Easy Agent reads instructions files and appends them to the system prompt, so you can set persistent rules, conventions, or preferences. It looks in two places:

1. **Global** — your home directory, applied to every conversation. Checks `~/.agents/AGENTS.md` first, then `~/.claude/CLAUDE.md`; uses the first one found.
2. **Project** — your current working directory, applied per-project. Checks `./AGENTS.md` first, then `./CLAUDE.md`; uses the first one found.

Both global and project files are loaded and concatenated into the system prompt if they exist.

### Skills (optional)

Skills are reusable prompts that register themselves as slash commands. Create a subdirectory for each skill under `~/.agents/skills/` (or `~/.claude/skills/`) with a `SKILL.md` file:

```
~/.claude/skills/
  deploy/
    SKILL.md
  review/
    SKILL.md
```

A `SKILL.md` with YAML frontmatter:

```markdown
---
name: deploy
description: Deploy the app to production
---

Run the deployment: build the project, then run `deploy.sh` with the `--prod` flag.
```

Only `name` is required; if omitted the directory name is used. The body is the full prompt injected when the skill is invoked. Skills appear as `/`-prefixed commands in the TUI alongside built-in slash commands.

## Usage

Launch the TUI:

```bash
easy-agent          # start a new session
easy-agent --continue  # resume the most recent session
easy-agent --resume <id>  # resume a specific session by ID
easy-agent --resume      # list all saved sessions for this directory
```

Type a prompt and press Enter. The agent streams its reply and calls tools as needed, showing each tool call and a one-line preview of its result. It iterates until the task is done (capped at 50 tool rounds per turn).

### Built-in tools

- **Shell** — run shell commands using this platform's native syntax.
- **FileRead** — read a file with line numbers; supports `offset`/`limit` for paging large files.
- **FileWrite** — create or fully overwrite a file.
- **FileEdit** — replace exact matches in a file; `replace_all` for every occurrence.
- **Glob** — list files, optionally filtered by a glob pattern.
- **Grep** — search file contents by regex with `glob`/`type` filters, context lines, case-insensitive, and `files_with_matches`/`count` output modes.
- **WebFetch** — fetch a URL as markdown or text.
- **AskUser** — ask the user a question and wait for their answer.
- **TodoWrite** — track multi-step work as a task list (pending / in_progress / completed), shown live as a panel in the TUI.

### Slash commands

| Command | Description |
|---------|-------------|
| `/mcp` | List linked MCP servers, their status, and exposed tools |
| `/clear` | Reset the conversation |
| `/compact` | Compress the conversation into a summary to free context |
| `/export` | Save the current conversation to `conversation-{timestamp}.jsonl` |
| `/quit` or `/exit` | Leave the app |

## Build from source

```bash
git clone https://github.com/vietor/easy-agent.git
cd easy-agent
pnpm install
pnpm build                 # build core → CLI
pnpm --filter @vietor/easy-agent dev   # hot-reload dev mode
```
