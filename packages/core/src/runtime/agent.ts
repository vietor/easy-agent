import { isAbortError, mapWithConcurrency, withAbort } from "../util/async.js";
import { MAX_PARALLEL_TOOL_CALLS, NOT_EXECUTED_PREFIX, SKILL_TOOL_NAME } from "../util/constants.js";
import { ellipsisText, errorMessage } from "../util/text.js";
import { parseToolArgs, textOf, type AssistantMessage, type LLMClient, type Message } from "../llm/types.js";
import { Conversation, type ConversationMessage } from "./conversation.js";
import { COMPACT_PROMPT, renderTodoReminder, renderIncompleteTodoNudge } from "./prompts.js";
import type { StreamEvent } from "./events.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext, ToolSchema, Todo } from "../tools/types.js";
import { toolError, type TextResult } from "../tools/types.js";

export type RunStatus = "ok" | "aborted" | "error" | "stalled" | "maxTurns";

export interface AgentOptions {
  llm: LLMClient;
  conversation: Conversation;
  tools: ToolRegistry;
  cwd: string;
  setTodos: (todos: Todo[]) => void;
  getTodos: () => readonly Todo[];
  stallThreshold: number;
  maxTurns: number;
  contextLimit: number;
  resolveSkill?: (name: string) => Skill | undefined;
}

type ToolCallResult = { id: string; content: string; resultSummary?: string; isError?: boolean; args: Record<string, unknown> };
type ChatResult = { ok: true; message: AssistantMessage } | { ok: false; status: RunStatus };

export class Agent {
  private llm: LLMClient;
  private conversation: Conversation;
  private tools: ToolRegistry;
  private cwd: string;
  private setTodos: (todos: Todo[]) => void;
  private getTodos: () => readonly Todo[];
  private stallThreshold: number;
  private maxTurns: number;
  readonly contextLimit: number;
  private todoSnapshot: readonly Todo[] = [];
  private resolveSkill?: (name: string) => Skill | undefined;
  private inputTokens = 0;
  private outputTokens = 0;

  constructor(opts: AgentOptions) {
    this.llm = opts.llm;
    this.conversation = opts.conversation;
    this.tools = opts.tools;
    this.cwd = opts.cwd;
    this.setTodos = opts.setTodos;
    this.getTodos = opts.getTodos;
    this.stallThreshold = opts.stallThreshold;
    this.maxTurns = opts.maxTurns;
    this.contextLimit = opts.contextLimit;
    this.resolveSkill = opts.resolveSkill;
  }

  get contextTokens(): number {
    return this.conversation.getEstimatedTokens();
  }

  get usage(): { inputTokens: number; outputTokens: number } {
    return { inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }

  resetUsage(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }

  get model() {
    return this.llm.model;
  }

  get thinkingEffort() {
    return this.llm.thinkingEffort;
  }

  clear(): void {
    this.conversation.clear();
  }

  export(): ConversationMessage[] {
    return this.conversation.export();
  }

  async compact(onEvent?: (e: StreamEvent) => void, signal?: AbortSignal): Promise<RunStatus> {
    const history = this.conversation.toLLM().slice(1);
    if (history.length === 0) return "ok";
    const request: Message[] = [...history];
    const todos = this.getTodos();
    if (todos.length) {
      request.push({ role: "user", content: renderTodoReminder(todos) });
    }
    request.push({ role: "user", content: COMPACT_PROMPT });
    const chat = await this.chatOnce(
      { messages: request, tools: [], thinking: false, onEvent, signal },
      () => onEvent?.({ type: "interrupted" })
    );
    if (!chat.ok) return chat.status;
    if (signal?.aborted) return "aborted";
    const compactText = textOf(chat.message.content);
    if (!compactText) {
      onEvent?.({ type: "error", text: "compact failed: LLM returned no summary text" });
      return "error";
    }
    this.conversation.compact(compactText);
    return "ok";
  }

  async run(
    userInput: string,
    onEvent?: (e: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    return this.runTurn({ role: "user", content: userInput }, onEvent, signal);
  }

  async runSkill(
    skill: Skill,
    onEvent?: (e: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    return this.runTurn({ role: "skill", name: skill.name, content: skill.prompt }, onEvent, signal);
  }

  private async runTurn(
    msg: ConversationMessage,
    onEvent?: (e: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
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

    let status: RunStatus;
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
    onEvent?: (e: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    let lastSig = "";
    let stall = 0;
    let turns = 0;
    let textOnlyStreak = 0;
    let pendingNudge = "";
    while (true) {
      if (this.conversation.getEstimatedTokens() > this.contextLimit) {
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
      const chat = await this.chatOnce(
        { messages, tools: this.tools.schemas(), onEvent, signal },
        () => {}
      );
      if (!chat.ok) return chat.status;
      if (signal?.aborted) return "aborted";
      const msg = chat.message;
      this.conversation.add(msg);
      this.conversation.collapseSkills();
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
        return "maxTurns";
      }
      const results = await this.runToolCalls(msg.tool_calls, onEvent, signal);
      if (!results) return "aborted";
      for (const r of results) {
        this.conversation.add({ role: "tool", tool_call_id: r.id, content: r.content, resultSummary: r.resultSummary, isError: r.isError });
      }
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i];
        if (tc.function.name !== SKILL_TOOL_NAME) continue;
        const name = results[i].args.name;
        if (typeof name !== "string" || !name) continue;
        const skill = this.resolveSkill?.(name);
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
    opts: { messages: Message[]; tools: ToolSchema[]; thinking?: boolean; onEvent?: (e: StreamEvent) => void; signal?: AbortSignal },
    onAbort: () => void
  ): Promise<ChatResult> {
    try {
      const message = await withAbort(this.llm.chat({
        messages: opts.messages,
        tools: opts.tools,
        thinking: opts.thinking,
        onDelta: (text) => opts.onEvent?.({ type: "assistant_delta", text }),
        onThinking: (text) => opts.onEvent?.({ type: "thinking_delta", text }),
        onRetry: (attempt, max, error) => opts.onEvent?.({ type: "retry", attempt, max, reason: errorMessage(error) }),
        onUsage: (inputTokens, outputTokens) => {
          this.inputTokens = inputTokens;
          this.outputTokens = outputTokens;
        },
        signal: opts.signal,
      }), opts.signal);
      return { ok: true, message };
    } catch (e) {
      if (opts.signal?.aborted || isAbortError(e)) {
        onAbort();
        return { ok: false, status: "aborted" };
      }
      opts.onEvent?.({ type: "error", text: errorMessage(e) });
      return { ok: false, status: "error" };
    }
  }

  private async runToolCalls(
    calls: NonNullable<AssistantMessage["tool_calls"]>,
    onEvent?: (e: StreamEvent) => void,
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
    onEvent?: (e: StreamEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolCallResult> {
    const parsed = parseToolArgs(call.function.arguments);
    const args = parsed.ok ? parsed.args : {};
    const argsError = parsed.ok ? undefined : toolError(`invalid arguments: ${parsed.error}`);
    const argsSummary = this.tools.summarizeArgs(call.function.name, args);
    onEvent?.({ type: "tool_start", id: call.id, name: call.function.name, argsSummary });
    const ctx: ToolContext = { signal, cwd: this.cwd };
    const start = performance.now();
    const result: TextResult = argsError ?? await this.tools.execute(call.function.name, args, ctx);
    const duration = performance.now() - start;
    const resultSummary = this.tools.summarizeResult(call.function.name, result, duration);
    if (!signal?.aborted) onEvent?.({ type: "tool_end", id: call.id, result: result.content, isError: result.isError, resultSummary });
    return { id: call.id, content: result.content, resultSummary, isError: result.isError, args };
  }
}
