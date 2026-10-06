import { join } from "node:path";
import { createInterface } from "node:readline";
import { createSession, SessionBusyError } from "@vietor/agent-core";
import { toErrorMessage } from "@vietor/agent-core/util";
import type { AskAnswer, AskedQuestion, RunMetrics, SessionEvent, Todo } from "@vietor/agent-core";

const { EASY_AGENT_BASE_URL, EASY_AGENT_API_KEY, EASY_AGENT_MODEL, EASY_AGENT_BACKEND, EASY_AGENT_SESSION_DIR } = process.env;

if (!EASY_AGENT_BASE_URL || !EASY_AGENT_API_KEY || !EASY_AGENT_MODEL) {
  process.stderr.write("Set EASY_AGENT_BASE_URL, EASY_AGENT_API_KEY and EASY_AGENT_MODEL (optionally EASY_AGENT_BACKEND, EASY_AGENT_SESSION_DIR).\n");
  process.exit(1);
}

const backend = EASY_AGENT_BACKEND === "anthropic" || EASY_AGENT_BACKEND === "responses" ? EASY_AGENT_BACKEND : "completions";

const session = await createSession({
  systemPrompt: "You are a concise terminal coding assistant. Use the built-in tools when they help.",
  llm: { baseUrl: EASY_AGENT_BASE_URL, apiKey: EASY_AGENT_API_KEY, model: EASY_AGENT_MODEL, backend },
  cwd: process.cwd(),
  builtInTools: { askUser: true, todoWrite: true },
  sessionDir: EASY_AGENT_SESSION_DIR,
  scratchDir: EASY_AGENT_SESSION_DIR ? join(EASY_AGENT_SESSION_DIR, "scratch") : undefined,
  sessionId: EASY_AGENT_SESSION_DIR ? "demo" : undefined,
});

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let pending: { id: string; questions: AskedQuestion[] } | undefined;
let metrics: RunMetrics | undefined;

function renderTodos(todos: Todo[]): void {
  if (todos.length === 0) return;
  const glyph = (todo: Todo) => (todo.status === "completed" ? "[x]" : todo.status === "inProgress" ? "[>]" : "[ ]");
  process.stdout.write(`\n${todos.map((todo) => `  ${glyph(todo)} ${todo.content}`).join("\n")}\n`);
}

function renderQuestion(questions: AskedQuestion[]): void {
  process.stdout.write("\n");
  questions.forEach((question, index) => {
    process.stdout.write(`${questions.length > 1 ? `Q${index + 1}: ` : ""}${question.question}${question.multiSelect ? " (several allowed)" : ""}\n`);
    question.options.forEach((option, optionIndex) => {
      process.stdout.write(`  ${optionIndex + 1}) ${option.label}${option.description ? ` — ${option.description}` : ""}\n`);
    });
  });
  process.stdout.write(
    questions.length > 1
      ? "Answer with option numbers per question, ';'-separated (e.g. 1;2,3); empty line skips.\n"
      : "Answer with the option number (','-separated for several); empty line skips.\n"
  );
}

function parseAnswers(questions: AskedQuestion[], line: string): AskAnswer[] {
  const segments = line.split(";");
  return questions.map((question, index) => {
    const segment = (segments[index] ?? "").trim();
    if (!segment) return "";
    const labels = segment
      .split(",")
      .map((part) => question.options[Number.parseInt(part.trim(), 10) - 1]?.label)
      .filter((label) => label !== undefined);
    if (labels.length === 0) return question.multiSelect ? "" : segment;
    return question.multiSelect ? labels : labels[0];
  });
}

function render(event: SessionEvent): void {
  switch (event.type) {
    case "assistant_delta":
      process.stdout.write(event.text);
      break;
    case "thinking_delta":
      process.stdout.write(`\x1b[2m${event.text}\x1b[22m`);
      break;
    case "tool_start":
      process.stdout.write(`\n[tool] ${event.name} ${event.argsSummary}\n`);
      break;
    case "tool_end":
      if (event.isError) process.stdout.write(`\n[tool failed] ${event.resultSummary ?? event.result}\n`);
      break;
    case "todos_changed":
      renderTodos(event.todos);
      break;
    case "error":
      process.stderr.write(`\n[error] ${event.text}\n`);
      break;
    case "question":
      pending = { id: event.id, questions: event.questions };
      renderQuestion(event.questions);
      break;
    case "run_metrics":
      metrics = event.running ? undefined : event;
      break;
    case "thinking_cleared":
    case "sub_agent_event":
    case "user":
    case "skill":
    case "assistant":
    case "tool":
    case "retry":
    case "interrupted":
    case "notice":
      break;
  }
}

session.onEvent(render);

async function run(text: string): Promise<void> {
  if (!text) {
    rl.prompt();
    return;
  }
  if (session.running) {
    process.stdout.write("[busy] a run is in progress — Ctrl+C aborts it\n");
    rl.prompt();
    return;
  }
  try {
    const result = await session.prompt(text);
    const stats = metrics;
    process.stdout.write(
      stats
        ? `\n[${result.status}] ${stats.cacheInputTokens + stats.missInputTokens} input / ${stats.outputTokens} output tokens in ${stats.elapsed}s\n`
        : `\n[${result.status}]\n`
    );
  } catch (error) {
    if (error instanceof SessionBusyError) process.stdout.write("\n[busy] another run is in progress\n");
    else process.stderr.write(`\n[error] ${toErrorMessage(error)}\n`);
  }
  pending = undefined;
  rl.prompt();
}

async function shutdown(): Promise<void> {
  await session.save();
  session.dispose();
  process.exit(0);
}

rl.on("line", (line) => {
  const text = line.trim();
  if (pending) {
    const { id, questions } = pending;
    pending = undefined;
    session.submitAnswer(id, parseAnswers(questions, text));
    return;
  }
  void run(text);
});

function onSigint(): void {
  if (session.running) {
    process.stdout.write("\n[aborting — Ctrl+C again exits]\n");
    session.abort();
    return;
  }
  rl.close();
}

rl.on("close", () => {
  process.stdout.write("\n");
  void shutdown();
});

rl.on("SIGINT", onSigint);
process.on("SIGINT", onSigint);

process.stdout.write(`easy-agent core embed — model ${session.model} — session ${session.sessionId}${session.filePath ? ` (${session.filePath})` : " (not persisted)"}\n`);
process.stdout.write("Type a message and press Enter. Ctrl+C aborts a run, Ctrl+C again (or Ctrl+D) exits.\n");
rl.prompt();
