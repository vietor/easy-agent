# @vietor/easy-agent-core

Lightweight AI agent framework — session orchestration, a built-in tool system, MCP client/server support, and a skill/command loader.

## Install

```bash
npm install @vietor/easy-agent-core
```

> Requires Node.js ≥ 22 (ESM only).

## Quick Start

```ts
import { startSession } from "@vietor/easy-agent-core";

const session = await startSession({
  systemPrompt: "You are a helpful assistant.",
  llmConfig: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o",
  },
});

// Send a user prompt and handle streaming events
session.setCallbacks({
  onStreaming: (text) => process.stdout.write(text),
  onRunStateChange: (s) => console.log(`Tokens: ${s.promptTokens} prompt / ${s.completionTokens} completion`),
});

await session.startPrompt("What files are in the current directory?");
```

## API

### Types

| Export | Description |
|--------|-------------|
| `Session` | Main session object — run prompts, control execution, query MCP servers, export conversations |
| `SessionCallbacks`, `RunState` | `onStreaming` for text, `onRunStateChange(state)` for a single runtime-state object (running, elapsed, token usage) |
| `LogEntry` | A single entry in the conversation log (user, assistant, tool, system, etc.) |
| `Tool`, `ToolContext`, `ToolResult`, `ToolSchema` | Define custom tools that the agent can invoke |
| `Todo`, `TodoStatus` | Task-tracking types used by the built-in TodoWrite tool |
| `BuiltinToolsOptions` | Toggles for opt-in built-in tools (AskUser, TodoWrite), passed via `SessionOptions.builtinTools` |
| `Command`, `CommandSchema`, `CommandContext` | Define slash commands; `execute(ctx, args)` receives raw text after the name, `ctx.exit()` asks the host to exit |
| `Skill` | A reusable prompt loaded from a SKILL.md file |
| `MCPServerConfig`, `MCPServerInfo` | MCP server config, and the status info returned by `session.mcpServers` |
| `LLMConfig` | OpenAI-compatible LLM endpoint configuration |
| `SessionOptions` | Options for `startSession` including `clientInfo` for MCP client identification |

### Functions

| Export | Description |
|--------|-------------|
| `startSession(opts)` | Create a fully-wired agent session with LLM client, tools, MCP, and commands |
| `tryLoadSkills(dir)` | Load skill definitions from a directory of SKILL.md files |
| `tryReadFileText(path)` | Read a text file, returning `null` on any failure |

### Built-in tools

`startSession()` registers the following tools by default:

- **Shell** — run shell commands
- **FileRead** — read files with line numbers
- **FileWrite** — create or overwrite files
- **FileEdit** — surgical text replacement
- **Glob** — file listing by pattern
- **Grep** — content search with regex
- **WebFetch** — fetch URL content

Two interactive tools are opt-in via `builtinTools` (they depend on host-provided callbacks):

- **AskUser** — prompt the user for input (`builtinTools.askUser`)
- **TodoWrite** — structured multi-step task tracking (`builtinTools.todoWrite`)

```ts
const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  builtinTools: { askUser: true, todoWrite: true },
});
```

## Extending

### Custom tools

Implement the `Tool` interface and pass it to `startSession`:

```ts
import type { Tool } from "@vietor/easy-agent-core";

const greetTool: Tool = {
  name: "greet",
  description: "Greet someone by name",
  parameters: { type: "object", properties: { name: { type: "string" } } },
  async execute(args) {
    return `Hello, ${args.name as string}!`;
  },
};

const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  tools: [greetTool],
});
```

### Custom commands

Implement the `Command` interface:

```ts
import type { Command } from "@vietor/easy-agent-core";

const helloCommand: Command = {
  name: "hello",
  description: "Say hello",
  async execute(ctx, args) {
    ctx.message(`Hello, ${args || "world"}!`);
  },
};
```

`execute(ctx, args)` receives the raw text typed after the command name. `ctx.exit()` asks the host to exit, `ctx.error(text)` reports an error to the log, and `ctx.session` exposes queries like `.mcpServers`, `.clear()`, `.compact()`.

### Skills

Load skills from `SKILL.md` files and pass them to `startSession`:

```ts
const skills = tryLoadSkills("./my-skills") ?? [];

const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  skills,
});
```
