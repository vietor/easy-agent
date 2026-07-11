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
  onUsageChange: (p, c) => console.log(`Tokens: ${p} prompt / ${c} completion`),
});

await session.startPrompt("What files are in the current directory?");
```

## API

### Types

| Export | Description |
|--------|-------------|
| `Session` | Main session object — run prompts, control execution, export conversations |
| `SessionCallbacks` | Callbacks for streaming text, runtime state, elapsed time, token usage |
| `LogEntry` | A single entry in the conversation log (user, assistant, tool, system, etc.) |
| `Tool`, `ToolContext`, `ToolResult`, `ToolSchema` | Define custom tools that the agent can invoke |
| `Todo`, `TodoStatus` | Task-tracking types used by the built-in TodoWrite tool |
| `BuiltinToolsOptions` | Toggles for opt-in built-in tools (AskUser, TodoWrite), passed via `SessionOptions.enableTools` |
| `Command`, `CommandSchema`, `CommandContext`, `CommandHost` | Define slash commands |
| `Skill` | A reusable prompt loaded from a SKILL.md file |
| `MCPServerConfig` | Configuration for connecting to an MCP tool server |
| `LLMConfig` | OpenAI-compatible LLM endpoint configuration |

### Functions

| Export | Description |
|--------|-------------|
| `startSession(opts)` | Create a fully-wired agent session with LLM client, tools, MCP, and commands |
| `tryLoadSkills(dir)` | Load skill definitions from a directory of SKILL.md files |
| `tryReadFileText(path)` | Read a text file, returning `null` on any failure |
| `readFirstFileContent(paths, loadFn)` | Try multiple paths in order and return the first successful result |
| `getPackageInfo()` | Read `name`, `version`, `description` from the nearest `package.json` |

### Built-in tools

`startSession()` registers the following tools by default:

- **Shell** — run shell commands
- **FileRead** — read files with line numbers
- **FileWrite** — create or overwrite files
- **FileEdit** — surgical text replacement
- **Glob** — file listing by pattern
- **Grep** — content search with regex
- **WebFetch** — fetch URL content

Two interactive tools are opt-in via `enableTools` (they depend on host-provided callbacks, and the corresponding tool-usage policy is only emitted to the system prompt when enabled):

- **AskUser** — prompt the user for input (`enableTools.askUser`)
- **TodoWrite** — structured multi-step task tracking (`enableTools.todoWrite`)

```ts
const session = await startSession({
  systemPrompt: "...",
  llmConfig: { ... },
  enableTools: { askUser: true, todoWrite: true },
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
  async execute(_ctx, host) {
    host.info("Hello from custom command!");
  },
};
```

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
