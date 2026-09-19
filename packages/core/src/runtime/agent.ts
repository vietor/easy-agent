import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { isAbortError, mapWithConcurrency, withAbort } from "../util/async.js";
import {
  COMPACT_TAIL_RATIO,
  MAX_TOOL_OUTPUT_BYTES,
  MAX_TOOL_OUTPUT_LINES,
  NOT_EXECUTED_PREFIX,
  PRUNE_MIN_CLEAR_RATIO,
  SKILL_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
} from "../util/constants.js";
import {
  estimateTokens,
  formatCompactNumber,
  getTextBytes,
  jsonSample,
  jsonShape,
  summarizeText,
  toErrorMessage,
  truncateOutput,
} from "../util/text.js";
import { parseToolCallArgs, toText, type LLMAssistantMessage } from "../llm/messages.js";
import type { ChatOptions, LLMClient, LLMUsage, ToolSchema } from "../llm/types.js";
import { SessionMessages, type SessionMessage } from "./session-messages.js";
import { COMPACT_PROMPT, renderCompactTodos, renderTodoReminder, renderIncompleteTodoNudge, renderPostCompactNotice, renderTurnBudget } from "./prompts.js";
import type { SessionEvent } from "./events.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext, Todo } from "../tools/types.js";
import { toolError, type TextResult } from "../tools/types.js";

export type RunStatus = "ok" | "aborted" | "error" | "stalled" | "maxTurns";

export interface RunLimits {
  maxTurns: number;
  stallThreshold: number;
  maxParallelToolCalls: number;
  contextLimit: number;
  scratchDir?: string;
}

export interface AgentOptions extends RunLimits {
  llm: LLMClient;
  conversation: SessionMessages;
  tools: ToolRegistry;
  cwd: string;
  setTodos: (todos: Todo[]) => void;
  getTodos: () => readonly Todo[];
  resolveSkill?: (name: string) => Skill | undefined;
  onCompact?: () => void;
  notesPath?: string;
}

type ChatResult = { ok: true; message: LLMAssistantMessage } | { ok: false; status: RunStatus };

interface ToolCallOutcome {
  id: string;
  content: string;
  resultSummary?: string;
  isError?: boolean;
  args: Record<string, unknown>;
}

export class Agent {
  private llm: LLMClient;
  private conversation: SessionMessages;
  private tools: ToolRegistry;
  private cwd: string;
  private setTodos: (todos: Todo[]) => void;
  private getTodos: () => readonly Todo[];
  private stallThreshold: number;
  private maxTurns: number;
  private maxParallelToolCalls: number;
  readonly contextLimit: number;
  private todoSnapshot: readonly Todo[] = [];
  private todoDeclared = false;
  private resolveSkill?: (name: string) => Skill | undefined;
  private onCompact?: () => void;
  private notesPath?: string;
  private pendingCompactNotice = "";
  private readonly scratchDir?: string;
  private readonly maxToolOutputBytes: number;
  private cacheInputTokens = 0;
  private missInputTokens = 0;
  private outputTokens = 0;
  private toolTokenCache: { schemas: ToolSchema[]; tokens: number } | null = null;

  constructor(opts: AgentOptions) {
    this.llm = opts.llm;
    this.conversation = opts.conversation;
    this.tools = opts.tools;
    this.cwd = opts.cwd;
    this.setTodos = opts.setTodos;
    this.getTodos = opts.getTodos;
    this.stallThreshold = opts.stallThreshold;
    this.maxTurns = opts.maxTurns;
    this.maxParallelToolCalls = opts.maxParallelToolCalls;
    this.contextLimit = opts.contextLimit;
    this.resolveSkill = opts.resolveSkill;
    this.onCompact = opts.onCompact;
    this.notesPath = opts.notesPath;
    this.scratchDir = opts.scratchDir;
    this.maxToolOutputBytes = Math.min(MAX_TOOL_OUTPUT_BYTES, Math.floor(opts.contextLimit / 2));
  }

  get contextTokens(): number {
    return this.conversation.getEstimatedTokens() + this.estimateToolTokens();
  }

  private estimateToolTokens(): number {
    const schemas = this.tools.schemas();
    if (this.toolTokenCache?.schemas !== schemas) {
      this.toolTokenCache = { schemas, tokens: estimateTokens(JSON.stringify(schemas)) };
    }
    return this.toolTokenCache.tokens;
  }

  get usage(): LLMUsage {
    return { cacheInputTokens: this.cacheInputTokens, missInputTokens: this.missInputTokens, outputTokens: this.outputTokens };
  }

  resetUsage(): void {
    this.cacheInputTokens = 0;
    this.missInputTokens = 0;
    this.outputTokens = 0;
  }

  addUsage(usage: LLMUsage): void {
    this.cacheInputTokens += usage.cacheInputTokens;
    this.missInputTokens += usage.missInputTokens;
    this.outputTokens += usage.outputTokens;
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

  export(): SessionMessage[] {
    return this.conversation.export();
  }

  async compact(onEvent?: (e: SessionEvent) => void, signal?: AbortSignal): Promise<RunStatus> {
    const request = this.conversation.toLLM().slice(1);
    if (request.length === 0) return "ok";
    const cachePrefixLen = request.length;
    const todos = this.getTodos();
    if (todos.length) {
      request.push({ role: "user", content: renderCompactTodos(todos) });
    }
    request.push({ role: "user", content: COMPACT_PROMPT });
    const chat = await this.chatOnce(
      {
        messages: request,
        tools: this.tools.schemas(),
        thinking: false,
        toolChoice: "none",
        cachePrefixLen,
        onEvent,
        signal,
      },
      () => onEvent?.({ type: "interrupted" })
    );
    if (!chat.ok) return chat.status;
    if (signal?.aborted) return "aborted";
    const compactText = toText(chat.message.content);
    if (!compactText) {
      onEvent?.({ type: "error", text: "compact failed: LLM returned no summary text" });
      return "error";
    }
    this.conversation.compact(compactText, Math.floor(this.contextLimit * COMPACT_TAIL_RATIO));
    if (this.notesPath) this.pendingCompactNotice = renderPostCompactNotice(this.notesPath);
    this.onCompact?.();
    return "ok";
  }

  async run(
    userInput: string,
    onEvent?: (e: SessionEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    return this.runTurn({ role: "user", content: userInput }, onEvent, signal);
  }

  async runSkill(
    skill: Skill,
    onEvent?: (e: SessionEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    return this.runTurn(this.conversation.skillMessage(skill.name, skill.prompt), onEvent, signal);
  }

  private async runTurn(
    msg: SessionMessage,
    onEvent?: (e: SessionEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    this.conversation.add(msg);
    this.conversation.createSnapshot();
    this.todoSnapshot = this.getTodos();
    this.todoDeclared = false;

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
    }
  }

  private async loop(
    onEvent?: (e: SessionEvent) => void,
    signal?: AbortSignal
  ): Promise<RunStatus> {
    let lastSig = "";
    let stall = 0;
    let turns = 0;
    let textOnlyStreak = 0;
    let pendingNudge = "";
    let nextCompactAbove = 0;
    while (true) {
      if (this.scratchDir && this.contextTokens > this.contextLimit) {
        const freed = this.conversation.pruneToolOutputs(Math.floor(this.contextTokens * PRUNE_MIN_CLEAR_RATIO));
        if (freed > 0) onEvent?.({ type: "notice", text: `cleared ${formatCompactNumber(freed)} tokens of old tool output` });
      }
      if (this.contextTokens > this.contextLimit && this.contextTokens > nextCompactAbove) {
        onEvent?.({ type: "notice", text: "auto-compacting context" });
        const compactStatus = await this.compact(
          (e) => { if (e.type === "error") onEvent?.(e); },
          signal
        );
        if (compactStatus !== "ok") return compactStatus;
        if (this.contextTokens > this.contextLimit) {
          nextCompactAbove = this.contextTokens + this.contextLimit;
          onEvent?.({ type: "notice", text: "context still exceeds the limit after compacting" });
        }
      }
      const finalTurn = turns >= this.maxTurns;
      const messages = this.conversation.toLLM();
      const cachePrefixLen = messages.length;
      const todos = this.getTodos();
      if (this.todoDeclared && todos.length && !pendingNudge) {
        messages.push({ role: "user", content: renderTodoReminder(todos) });
      }
      if (pendingNudge && !finalTurn) {
        messages.push({ role: "user", content: pendingNudge });
        pendingNudge = "";
      }
      if (this.pendingCompactNotice) {
        messages.push({ role: "user", content: this.pendingCompactNotice });
        this.pendingCompactNotice = "";
      }
      const budget = renderTurnBudget(turns, this.maxTurns);
      if (budget) messages.push({ role: "user", content: budget });
      const chat = await this.chatOnce(
        { messages, tools: this.tools.schemas(), toolChoice: finalTurn ? "none" : undefined, cachePrefixLen, onEvent, signal },
        () => {}
      );
      if (!chat.ok) return chat.status;
      if (signal?.aborted) return "aborted";
      const msg = chat.message;
      this.conversation.add(msg);
      if (!msg.tool_calls?.length) {
        if (!finalTurn && this.todoDeclared && todos.length > 0 && todos.some(t => t.status !== "completed")) {
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
        const reason = `stalled: repeated identical tool calls: ${summarizeText(sig, 200)}`;
        this.resolvePendingToolCalls(msg.tool_calls, reason);
        onEvent?.({ type: "error", text: `agent stalled: ${reason}` });
        return "stalled";
      }
      if (++turns > this.maxTurns) {
        this.resolvePendingToolCalls(msg.tool_calls, `max turns reached (${this.maxTurns})`);
        onEvent?.({ type: "error", text: `agent exceeded max turns (${this.maxTurns}) despite the tools being disabled; the conversation is intact — send another message to resume with a fresh budget` });
        return "maxTurns";
      }
      const results = await this.runToolCalls(msg.tool_calls, onEvent, signal);
      if (!results) return "aborted";
      for (const r of results) {
        this.conversation.add({ role: "tool", tool_call_id: r.id, content: r.content, resultSummary: r.resultSummary, isError: r.isError });
      }
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i];
        if (tc.function.name === TODO_WRITE_TOOL_NAME && !results[i].isError) this.todoDeclared = true;
        if (tc.function.name !== SKILL_TOOL_NAME) continue;
        const name = results[i].args.name;
        if (typeof name !== "string" || !name) continue;
        const skill = this.resolveSkill?.(name);
        if (!skill) continue;
        this.conversation.add(this.conversation.skillMessage(skill.name, skill.prompt));
        onEvent?.({ type: "skill", name: skill.name });
      }
    }
  }

  private resolvePendingToolCalls(calls: NonNullable<LLMAssistantMessage["tool_calls"]>, reason: string): void {
    for (const tc of calls) {
      this.conversation.add({ role: "tool", tool_call_id: tc.id, content: `${NOT_EXECUTED_PREFIX}${reason})`, isError: true });
    }
  }

  private async chatOnce(
    opts: Pick<ChatOptions, "messages" | "tools" | "thinking" | "toolChoice" | "cachePrefixLen" | "signal"> & { onEvent?: (e: SessionEvent) => void },
    onAbort: () => void
  ): Promise<ChatResult> {
    try {
      let usage: LLMUsage | undefined;
      const message = await withAbort(this.llm.chat({
        messages: opts.messages,
        tools: opts.tools,
        thinking: opts.thinking,
        toolChoice: opts.toolChoice,
        cachePrefixLen: opts.cachePrefixLen,
        onDelta: (text) => opts.onEvent?.({ type: "assistant_delta", text }),
        onThinking: (text) => opts.onEvent?.({ type: "thinking_delta", text }),
        onRetry: (attempt, max, error) => opts.onEvent?.({ type: "retry", attempt, max, reason: toErrorMessage(error) }),
        onUsage: (u) => {
          usage = u;
        },
        signal: opts.signal,
      }), opts.signal);
      if (usage) this.addUsage(usage);
      return { ok: true, message };
    } catch (e) {
      if (opts.signal?.aborted || isAbortError(e)) {
        onAbort();
        return { ok: false, status: "aborted" };
      }
      opts.onEvent?.({ type: "error", text: toErrorMessage(e) });
      return { ok: false, status: "error" };
    }
  }

  private async runToolCalls(
    calls: NonNullable<LLMAssistantMessage["tool_calls"]>,
    onEvent?: (e: SessionEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolCallOutcome[] | null> {
    const results = await mapWithConcurrency(
      calls,
      this.maxParallelToolCalls,
      (call) => this.executeToolCall(call, onEvent, signal),
      signal
    );
    return signal?.aborted ? null : results;
  }

  private async executeToolCall(
    call: NonNullable<LLMAssistantMessage["tool_calls"]>[number],
    onEvent?: (e: SessionEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolCallOutcome> {
    const parsed = parseToolCallArgs(call.function.arguments);
    const args = parsed.ok ? parsed.args : {};
    const argsError = parsed.ok ? undefined : toolError(`invalid arguments: ${parsed.error}`);
    const argsSummary = this.tools.summarizeArgs(call.function.name, args);
    onEvent?.({ type: "tool_start", id: call.id, name: call.function.name, argsSummary });
    const ctx: ToolContext = { signal, cwd: this.cwd };
    const start = performance.now();
    const result: TextResult = argsError ?? await this.tools.execute(call.function.name, args, ctx);
    const duration = performance.now() - start;
    const summary = this.tools.summarizeResult(call.function.name, result, duration);
    const captured = await this.captureLargeOutput(call.function.name, result);
    const resultSummary = captured.truncated
      ? `${summary} · truncated${captured.outputPath ? `, full output: ${captured.outputPath}` : ""}`
      : summary;
    if (!signal?.aborted) onEvent?.({ type: "tool_end", id: call.id, result: captured.content, isError: result.isError, resultSummary });
    return { id: call.id, content: captured.content, resultSummary, isError: result.isError, args };
  }

  private async captureLargeOutput(
    name: string,
    result: TextResult
  ): Promise<{ content: string; outputPath?: string; truncated?: boolean }> {
    const { content, structured } = result;
    if (!this.scratchDir) return { content };
    const tail = this.tools.truncateDirection(name) === "tail";
    const cut = truncateOutput(content, tail ? "tail" : "head", this.maxToolOutputBytes, MAX_TOOL_OUTPUT_LINES);
    if (!cut.truncated) return { content };
    const json = structured === undefined ? undefined : JSON.stringify(structured, null, 2);
    let outputPath: string | undefined;
    if (this.tools.persistOutput(name)) {
      try {
        await mkdir(this.scratchDir, { recursive: true });
        outputPath = join(this.scratchDir, `${randomUUID()}.txt`);
        await writeFile(outputPath, json ?? content, "utf-8");
      } catch {
        return { content };
      }
    }
    if (json !== undefined && outputPath) {
      const count = Array.isArray(structured) ? `, ${formatCompactNumber(structured.length)} items` : "";
      const notice = [
        `JSON output not inlined: ${formatCompactNumber(getTextBytes(json))} bytes${count}.`,
        `Shape: ${jsonShape(structured)}`,
      ];
      const sample = jsonSample(structured);
      if (sample) notice.push(`Sample: ${sample}`);
      notice.push(`Full output saved to: ${outputPath}`, "Use Shell with jq, or Read with offset/limit, to query specific fields.");
      return { content: notice.join("\n"), outputPath, truncated: true };
    }
    const lines = [
      `...output truncated: showing the ${tail ? "last" : "first"} ${cut.keptLines} of ${cut.totalLines} lines (${formatCompactNumber(cut.totalBytes)} bytes total)...`,
      "",
    ];
    if (outputPath) {
      lines.push(`Full output saved to: ${outputPath}`, "Use Read with offset/limit to view specific sections, or Grep to search the full file.");
    } else {
      lines.push("Use Read with offset/limit to page through the file.");
    }
    const notice = lines.join("\n");
    return { content: tail ? `${notice}\n\n${cut.text}` : `${cut.text}\n\n${notice}`, outputPath, truncated: true };
  }
}
