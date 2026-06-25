# Easy Agent

An autonomous coding agent in the terminal: an LLM-driven tool loop with a React/Ink TUI, transported via the OpenAI SDK and compatible with any OpenAI-compatible endpoint.

## Requirements

- Node.js ≥ 18
- pnpm (`packageManager: pnpm@10.30.3`)

## Install

```bash
pnpm install
```

## Configuration

Create `~/.easy-agent.json`:

```json
{
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "your-api-key",
  "model": "your-model"
}
```

All of `baseUrl`, `apiKey`, and `model` are required.

## Run

```bash
pnpm dev      # run src/cli.ts via tsx
pnpm build    # compile to dist/ with tsc
pnpm start    # build then node dist/cli.js
```

Type a prompt in the TUI. Use `/quit` or `/exit` to leave, `/clear` to reset the session.
