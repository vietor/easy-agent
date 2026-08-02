import { withAbort } from "../util/async.js";
import type { LLMClient } from "../llm/client.js";
import { parseToolArgs, type AssistantMessage, type Message } from "../llm/types.js";
import type { Conversation, ConversationMessage } from "./conversation.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { SKILL_TOOL_NAME } from "../tools/skill.js";
import type { ToolContext, ToolResult, Todo } from "../tools/types.js";


const COMPACT_PROMPT = [
  "Summarize the conversation above for context continuation. Preserve:\n",
  "1. Primary goal, sub-goals, constraints, acceptance criteria.\n",
  "2. Decisions and rationale (including rejected approaches).\n",
  "3. Files (paths, signatures, config values, key code snippets).\n",
  "4. Tool calls and relevant results (commands, search hits, test output).\n",
  "5. Errors/failures and how they were resolved.\n",
  "6. Current progress: what is done, verified, and in-progress state.\n",
  "7. Pending tasks, open questions, concrete next step.\n",
  "Discard: completed small talk, verbose tool outputs already absorbed, resolved dead ends. Keep only what the next turn needs to continue without re-reading history.\n",
  "Concise but thorough; keep technical specifics; use the conversation language. ",
  "Start with \"Summary of conversation so far\":",
].join("");

export type RunStatus = "ok" | "aborted" | "error" | "stalled" | "maxturns";

export type AgentEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "retry"; attempt: number; max: number }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; preview?: string }
  | { type: "skill"; name: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "notice"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number };

export interface AgentOptions {
  llm: LLMClient;
  conversation: Conversation;
  tools: ToolRegistry;
  cwd: string;
  setTodos: (todos: Todo[]) => void;
  getTodos: () => readonly Todo[];
  stallThreshold: number;
  maxTurns: number;
  compactThreshold: number;
  resolveSkill?: (name: string) => Skill | undefined;
}

export class Agent {
  private llm: LLMClient;
  private conversation: Conversation;
  private tools: ToolRegistry;
  private cwd: string;
  private setTodos: (todos: Todo[]) => void;
  private getTodos: () => readonly Todo[];
  private stallThreshold: number;
  private maxTurns: number;
  readonly compactThreshold: number;
  private todoSnapshot: readonly Todo[] = [];
  private resolveSkill?: (name: string) => Skill | undefined;

  constructor(opts: AgentOptions) {
    this.llm = opts.llm;
    this.conversation = opts.conversation;
    this.tools = opts.tools;
    this.cwd = opts.cwd;
    this.setTodos = opts.setTodos;
    this.getTodos = opts.getTodos;
    this.stallThreshold = opts.stallThreshold;
    this.maxTurns = opts.maxTurns;
    this.compactThreshold = opts.compactThreshold;
    this.resolveSkill = opts.resolveSkill;
  }

  get contextTokens(): number {
    return this.conversation.getEstimatedTokens();
  }

  get model() {
    return this.llm.model;
  }

  get reasoningEffort() {
    return this.llm.reasoningEffort;
  }

  clear(): void {
    this.conversation.clear();
  }

  export(): ConversationMessage[] {
    return this.conversation.export();
  }

  async compact(onEvent?: (e: AgentEvent) => void, signal?: AbortSignal): Promise<RunStatus> {
    const history = this.conversation.toLLM().slice(1);
    if (history.length === 0) return "ok";
    const request: Message[] = [...history];
    const todos = this.getTodos();
    if (todos.length) {
      request.push({ role: "user", content: renderTodoReminder(todos) });
    }
    request.push({ role: "user", content: COMPACT_PROMPT });
    let msg: AssistantMessage;
    try {
      msg = await withAbort(this.llm.chat({
        messages: request,
        tools: [],
        reasoning: false,
        onDelta: (text) => onEvent?.({ type: "assistant_delta", text }),
        onRetry: (attempt, max) => onEvent?.({ type: "retry", attempt, max }),
        onUsage: (inputTokens, outputTokens) => onEvent?.({ type: "usage", inputTokens, outputTokens }),
        signal,
      }), signal);
    } catch (e) {
      if (signal?.aborted) {
        onEvent?.({ type: "interrupted" });
        return "aborted";
      }
      onEvent?.({ type: "error", text: (e as Error).message });
      return "error";
    }
    const compactText = (typeof msg.content === "string" ? msg.content : "") || "";
    if (!compactText) {
      onEvent?.({ type: "error", text: "compact failed: LLM returned no summary text" });
      return "error";
    }
    this.conversation.compact(compactText);
    return "ok";
  }

  async run(
    userInput: string,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    return this.runTurn({ role: "user", content: userInput }, onEvent, signal);
  }

  async runSkill(
    skill: Skill,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    return this.runTurn({ role: "skill", name: skill.name, content: skill.prompt }, onEvent, signal);
  }

  private async runTurn(
    msg: ConversationMessage,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    this.conversation.add(msg);
    this.conversation.createSnapshot();
    this.todoSnapshot = this.getTodos();

    const onAbort = () => {
      this.conversation.restoreFromSnapshot();
      this.setTodos([...this.todoSnapshot]);
      onEvent?.({ type: "interrupted" });
    };

    let status: RunStatus;
    try {
      status = await withAbort(this.loop(onEvent, signal), signal);
      if (status === "aborted") {
        onAbort();
      }
      return status;
    } catch (e) {
      if (signal?.aborted) {
        onAbort();
        return "aborted";
      }
      throw e;
    } finally {
      this.conversation.clearSnapshot();
      this.todoSnapshot = [];
      this.conversation.collapseSkills();
    }
  }

  private async loop(
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    let lastSig = "";
    let stall = 0;
    let turns = 0;
    let textOnlyStreak = 0;
    let pendingNudge = "";
    while (true) {
      if (this.conversation.getEstimatedTokens() > this.compactThreshold) {
        onEvent?.({ type: "notice", text: "auto-compacting context" });
        const compactStatus = await this.compact(undefined, signal);
        if (compactStatus !== "ok") return compactStatus;
      }
      const messages = this.conversation.toLLM();
      const todos = this.getTodos();
      if (todos.length) {
        messages.push({ role: "user", content: renderTodoReminder(todos) });
      }
      if (pendingNudge) {
        messages.push({ role: "user", content: pendingNudge });
        pendingNudge = "";
      }
      let msg: AssistantMessage;
      try {
        msg = await withAbort(this.llm.chat({
          messages,
          tools: this.tools.schemas(),
          onDelta: (text) => onEvent?.({ type: "assistant_delta", text }),
          onReasoning: (text) => onEvent?.({ type: "reasoning_delta", text }),
          onRetry: (attempt, max) => onEvent?.({ type: "retry", attempt, max }),
          onUsage: (inputTokens, outputTokens) => onEvent?.({ type: "usage", inputTokens, outputTokens }),
          signal,
        }), signal);
      } catch (e) {
        if (signal?.aborted) return "aborted";
        onEvent?.({ type: "error", text: (e as Error).message });
        return "error";
      }
      this.conversation.add(msg);
      if (!msg.tool_calls?.length) {
        const todos = this.getTodos();
        if (todos.length > 0 && todos.some(t => t.status !== "completed")) {
          if (++textOnlyStreak >= this.stallThreshold) {
            onEvent?.({ type: "error", text: `agent stalled: ${textOnlyStreak} text-only responses with incomplete tasks` });
            return "stalled";
          }
          pendingNudge = renderIncompleteTodoNudge(todos);
          continue;
        }
        return "ok";
      }
      textOnlyStreak = 0;
      const sig = msg.tool_calls
        .map((c) => `${c.function.name}:${c.function.arguments}`)
        .join("|");
      stall = sig === lastSig ? stall + 1 : 1;
      lastSig = sig;
      if (stall >= this.stallThreshold) {
        onEvent?.({ type: "error", text: `agent stalled: repeated identical tool calls` });
        return "stalled";
      }
      if (++turns >= this.maxTurns) {
        onEvent?.({ type: "error", text: `agent exceeded max turns (${this.maxTurns})` });
        return "maxturns";
      }
      const results = await this.runToolCalls(msg.tool_calls, onEvent, signal);
      if (!results) return "aborted";
      for (const r of results) {
        this.conversation.add({ role: "tool", tool_call_id: r.id, content: r.content, preview: r.preview, isError: r.isError });
      }
      for (const tc of msg.tool_calls) {
        if (tc.function.name !== SKILL_TOOL_NAME || !this.resolveSkill) continue;
        const { args } = parseToolArgs(tc.function.arguments);
        const name = args.name as string;
        if (!name) continue;
        const skill = this.resolveSkill(name);
        if (!skill) continue;
        this.conversation.add({ role: "skill", name: skill.name, content: skill.prompt });
        onEvent?.({ type: "skill", name: skill.name });
      }
    }
  }

  private async runToolCalls(
    calls: NonNullable<AssistantMessage["tool_calls"]>,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<{ id: string; content: string; preview?: string; isError?: boolean }[] | null> {
    return withAbort(Promise.all(
      calls.map(async (call) => {
        const parsed = parseToolArgs(call.function.arguments);
        const args = parsed.args;
        const argsError = parsed.error ? `Error: invalid arguments: ${parsed.error}` : "";
        const summary = this.tools.summarize(call.function.name, args);
        onEvent?.({ type: "tool_start", id: call.id, name: call.function.name, summary });
        const ctx: ToolContext = { signal, cwd: this.cwd };
        const start = performance.now();
        const result: ToolResult = argsError
          ? { content: argsError, isError: true }
          : await this.tools.execute(call.function.name, args, ctx);
        const duration = performance.now() - start;
        const preview = this.tools.getPreview(call.function.name, result, duration);
        if (!signal?.aborted) onEvent?.({ type: "tool_end", id: call.id, result: result.content, isError: result.isError, preview });
        return { id: call.id, content: result.content, preview, isError: result.isError };
      })
    ), signal, () => null);
  }
}

function renderTodoReminder(todos: readonly Todo[]): string {
  const items = todos.map((t) => {
    const mark = t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○";
    return `${mark} ${t.content}`;
  });
  const focus = todos.find((t) => t.status === "in_progress");
  const focusLine = focus ? ` Current focus: ${focus.content}` : "";
  const incomplete = todos.filter(t => t.status !== "completed");
  const warning = incomplete.length > 0
    ? ` ${incomplete.length} incomplete. You MUST complete EVERY task before your final text-only response — update status via TodoWrite after each task finishes.`
    : "";
  return `<system-reminder>Tasks: ${items.join(" | ")}${focusLine}${warning}</system-reminder>`;
}

function renderIncompleteTodoNudge(todos: readonly Todo[]): string {
  const incomplete = todos.filter(t => t.status !== "completed");
  const names = incomplete.map(t => `"${t.content}"`).join(", ");
  return `<system-reminder>STOP! You have ${incomplete.length} incomplete task(s): ${names}. Use tools to complete them. Call TodoWrite to mark each one completed before your final text response.</system-reminder>`;
}
