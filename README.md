# Easy Agent

An autonomous coding agent in the terminal. An LLM drives a tool loop — reading, editing, and running commands in your project — presented through a React/Ink TUI. It talks to any OpenAI-compatible endpoint via the OpenAI SDK.

## Requirements

- Node.js ≥ 22

## Install

Install globally with npm:

```bash
npm install -g @vietor/easy-agent
```

Or run it once without installing:

```bash
npx @vietor/easy-agent
```

## Configuration

Create `~/.easy-agent.json` in your home directory (`C:\Users\<you>\.easy-agent.json` on Windows):

```json
{
  "llm": {
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "your-api-key",
    "model": "your-model"
  }
}
```

`llm.baseUrl`, `llm.apiKey`, and `llm.model` are all required. Point `baseUrl` at any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, local servers, etc.) and set `model` to a model that endpoint serves.

### Optional: MCP servers

Add an `mcpServers` map to expose external tools through the Model Context Protocol. Each entry spawns a local process (stdio transport):

```json
{
  "llm": { ... },
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "chrome-devtools-mcp@latest",
        "--auto-connect",
        "--accept-insecure-certs"
      ]
    }
  }
}
```

Only `command` is required; `args` and `env` are optional. MCP tools become available to the agent as `MCP__<server>__<tool>`. If a server fails to connect within 30s, it is disabled and the error is shown in the TUI — the rest keep running.

## Usage

Launch the TUI:

```bash
easy-agent
```

Type a prompt and press Enter. The agent streams its reply and calls tools as needed, showing each tool call and a one-line preview of its result. It iterates until the task is done (capped at 25 tool rounds per turn).

Built-in tools:

- **Shell** — run shell commands using this platform's native syntax.
- **FileRead** — read a file's full contents.
- **FileWrite** — create or fully overwrite a file.
- **FileEdit** — replace one exact, unique match within a file.
- **Glob** — list files, optionally filtered by a glob pattern.
- **Grep** — search file contents by regex.
- **WebFetch** — fetch a URL as markdown or text.

Slash commands:

- `/mcp` — list linked MCP servers, their status, and exposed tools.
- `/clear` — reset the conversation.
- `/quit` or `/exit` — leave the app.
