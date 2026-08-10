import { isAbortError, mapWithConcurrency, withAbort } from "../util/async.js";
import { MAX_PARALLEL_TOOL_CALLS, NOT_EXECUTED_PREFIX, SKILL_TOOL_NAME } from "../util/constants.js";
import { ellipsisText, errorMessage } from "../util/text.js";
import { parseToolArgs, textOf, type AssistantMessage, type LLMClient, type Message } from "../llm/types.js";
import type { Conversation, ConversationMessage } from "./conversation.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import { toolError, type ToolContext, type ToolSchema, type Todo, type TodoStatus } from "../tools/types.js";
import type { ContentResult } from "../util/types.js";


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
  "Concise but thorough; keep technical specifics; use the conversation language. Target roughly 10% of the original length, capped at a few hundred tokens — technical specifics over prose. ",
  "Start with \"Summary of conversation so far\":",
].join("");

export type AgentRunStatus = "ok" | "aborted" | "error" | "stalled" | "max_turns";

export type AgentEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "retry"; attempt: number; max: number; reason: string }
  | { type: "tool_start"; id: string; name: string; argsSummary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean; resultSummary?: string }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "notice"; text: string }
  | { type: "skill"; name: string }
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

type ToolCallResult = { id: string; content: string; resultSummary?: string; isError?: boolean; args: Record<string, unknown> };

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

  async compact(onEvent?: (e: AgentEvent) => void, signal?: AbortSignal): Promise<AgentRunStatus> {
    const history = this.conversation.toLLM().slice(1);
    if (history.length === 0) return "ok";
    const request: Message[] = [...history];
    const todos = this.getTodos();
    if (todos.length) {
      request.push({ role: "user", content: renderTodoReminder(todos) });
    }
    request.push({ role: "user", content: COMPACT_PROMPT });
    const msg = await this.chatOnce(
      { messages: request, tools: [], reasoning: false, onEvent, signal },
      () => onEvent?.({ type: "interrupted" })
    );
    if (typeof msg === "string") return msg;
    if (signal?.aborted) return "aborted";
    const compactText = textOf(msg.content);
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
  ): Promise<AgentRunStatus> {
    return this.runTurn({ role: "user", content: userInput }, onEvent, signal);
  }

  async runSkill(
    skill: Skill,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<AgentRunStatus> {
    return this.runTurn({ role: "skill", name: skill.name, content: skill.prompt }, onEvent, signal);
  }

  private async runTurn(
    msg: ConversationMessage,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<AgentRunStatus> {
    this.conversation.add(msg);
    this.conversation.createSnapshot();
    this.todoSnapshot = this.getTodos();

    let aborted = false;
    const onAbort = () => {
      if (aborted) return;
      aborted = true;
      this.conversation.restoreFromSnapshot();
      this.setTodos([...this.todoSnapshot]);
      onEvent?.({ type: "interrupted" });
    };

    let status: AgentRunStatus;
    try {
      status = await withAbort(this.loop(onEvent, signal), signal);
      if (status === "aborted") {
        onAbort();
      }
      return status;
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) {
        onAbort();
        return "aborted";
      }
      throw e;
    } finally {
      this.conversation.clearSnapshot();
      this.todoSnapshot = [];
      this.conversation.normalizeInterruptedToolCalls();
      this.conversation.collapseSkills();
    }
  }

  private async loop(
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<AgentRunStatus> {
    let lastSig = "";
    let stall = 0;
    let turns = 0;
    let textOnlyStreak = 0;
    let pendingNudge = "";
    while (true) {
      if (this.conversation.getEstimatedTokens() > this.compactThreshold) {
        onEvent?.({ type: "notice", text: "auto-compacting context" });
        const compactStatus = await this.compact(
          (e) => { if (e.type === "error") onEvent?.(e); },
          signal
        );
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
      const msg = await this.chatOnce(
        { messages, tools: this.tools.schemas(), onEvent, signal },
        () => {}
      );
      if (typeof msg === "string") return msg;
      if (signal?.aborted) return "aborted";
      this.conversation.add(msg);
      if (!msg.tool_calls?.length) {
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
        const reason = `stalled: repeated identical tool calls: ${ellipsisText(sig, 200)}`;
        this.resolvePendingToolCalls(msg.tool_calls, reason);
        onEvent?.({ type: "error", text: `agent stalled: ${reason}` });
        return "stalled";
      }
      if (++turns >= this.maxTurns) {
        this.resolvePendingToolCalls(msg.tool_calls, `max turns reached (${this.maxTurns})`);
        onEvent?.({ type: "error", text: `agent exceeded max turns (${this.maxTurns})` });
        return "max_turns";
      }
      const results = await this.runToolCalls(msg.tool_calls, onEvent, signal);
      if (!results) return "aborted";
      for (const r of results) {
        this.conversation.add({ role: "tool", tool_call_id: r.id, content: r.content, resultSummary: r.resultSummary, isError: r.isError });
      }
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i];
        if (tc.function.name !== SKILL_TOOL_NAME || !this.resolveSkill) continue;
        const { args } = results[i];
        const name = args.name as string;
        if (!name) continue;
        const skill = this.resolveSkill(name);
        if (!skill) continue;
        this.conversation.add({ role: "skill", name: skill.name, content: skill.prompt });
        onEvent?.({ type: "skill", name: skill.name });
      }
    }
  }

  private resolvePendingToolCalls(calls: NonNullable<AssistantMessage["tool_calls"]>, reason: string): void {
    for (const tc of calls) {
      this.conversation.add({ role: "tool", tool_call_id: tc.id, content: `${NOT_EXECUTED_PREFIX}${reason})`, isError: true });
    }
  }

  private async chatOnce(
    opts: { messages: Message[]; tools: ToolSchema[]; reasoning?: boolean; onEvent?: (e: AgentEvent) => void; signal?: AbortSignal },
    onAbort: () => void
  ): Promise<AssistantMessage | AgentRunStatus> {
    try {
      return await withAbort(this.llm.chat({
        messages: opts.messages,
        tools: opts.tools,
        reasoning: opts.reasoning,
        onDelta: (text) => opts.onEvent?.({ type: "assistant_delta", text }),
        onReasoning: (text) => opts.onEvent?.({ type: "reasoning_delta", text }),
        onRetry: (attempt, max, error) => opts.onEvent?.({ type: "retry", attempt, max, reason: errorMessage(error) }),
        onUsage: (inputTokens, outputTokens) => opts.onEvent?.({ type: "usage", inputTokens, outputTokens }),
        signal: opts.signal,
      }), opts.signal);
    } catch (e) {
      if (opts.signal?.aborted || isAbortError(e)) {
        onAbort();
        return "aborted";
      }
      opts.onEvent?.({ type: "error", text: errorMessage(e) });
      return "error";
    }
  }

  private async runToolCalls(
    calls: NonNullable<AssistantMessage["tool_calls"]>,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolCallResult[] | null> {
    const results = await mapWithConcurrency(
      calls,
      MAX_PARALLEL_TOOL_CALLS,
      (call) => this.executeToolCall(call, onEvent, signal),
      signal
    );
    return signal?.aborted ? null : results;
  }

  private async executeToolCall(
    call: NonNullable<AssistantMessage["tool_calls"]>[number],
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolCallResult> {
    const parsed = parseToolArgs(call.function.arguments);
    const args = parsed.args;
    const argsError = parsed.error ? toolError(`invalid arguments: ${parsed.error}`) : undefined;
    const argsSummary = this.tools.summarizeArgs(call.function.name, args);
    onEvent?.({ type: "tool_start", id: call.id, name: call.function.name, argsSummary });
    const ctx: ToolContext = { signal, cwd: this.cwd };
    const start = performance.now();
    const result: ContentResult = argsError ?? await this.tools.execute(call.function.name, args, ctx);
    const duration = performance.now() - start;
    const resultSummary = this.tools.summarizeResult(call.function.name, result, duration);
    if (!signal?.aborted) onEvent?.({ type: "tool_end", id: call.id, result: result.content, isError: result.isError, resultSummary });
    return { id: call.id, content: result.content, resultSummary, isError: result.isError, args };
  }
}

const STATUS_GLYPHS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
};

function renderTodoReminder(todos: readonly Todo[]): string {
  const items = todos.map((t) => {
    return `${STATUS_GLYPHS[t.status]} ${t.content}`;
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
