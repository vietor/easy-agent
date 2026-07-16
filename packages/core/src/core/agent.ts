import { withAbort, withAbortFallback } from "../util/async.js";
import type { LLMClient } from "../llm/client.js";
import type { AssistantMessage, Message } from "../llm/types.js";
import type { Conversation, ConversationMessage } from "./conversation.js";
import type { Skill } from "../skills/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext, ToolResult, Todo } from "../tools/types.js";

const COMPACT_PROMPT = "Summarize this conversation into a concise context summary. Preserve the user's goal, decisions made, files touched, and current progress. Write the summary in the same language the user used in the conversation. Begin your reply with \"Summary of conversation so far\":";

export type AgentEvent =
  | { type: "delta"; text: string }
  | { type: "retry"; attempt: number; max: number }
  | { type: "tool_start"; id: string; name: string; summary: string }
  | { type: "tool_end"; id: string; result: string; isError?: boolean }
  | { type: "error"; text: string }
  | { type: "interrupted" }
  | { type: "usage"; promptTokens: number; completionTokens: number };

export interface AgentOptions {
  llm: LLMClient;
  conversation: Conversation;
  tools: ToolRegistry;
  cwd: string;
  ask: (question: string, options: string[]) => Promise<string>;
  setTodos: (todos: Todo[]) => void;
  getTodos: () => readonly Todo[];
  stallThreshold?: number;
  maxTurns?: number;
  compactThreshold?: number;
}

export class Agent {
  private llm: LLMClient;
  private conversation: Conversation;
  private tools: ToolRegistry;
  private cwd: string;
  private ask: (question: string, options: string[]) => Promise<string>;
  private setTodos: (todos: Todo[]) => void;
  private getTodos: () => readonly Todo[];
  private stallThreshold: number;
  private maxTurns: number;
  private compactThreshold: number;
  private todoSnapshot: readonly Todo[] = [];

  constructor(opts: AgentOptions) {
    this.llm = opts.llm;
    this.conversation = opts.conversation;
    this.tools = opts.tools;
    this.cwd = opts.cwd;
    this.ask = opts.ask;
    this.setTodos = opts.setTodos;
    this.getTodos = opts.getTodos;
    this.stallThreshold = opts.stallThreshold ?? 3;
    this.maxTurns = opts.maxTurns ?? 50;
    this.compactThreshold = opts.compactThreshold ?? 500_000;
  }

  get contextTokens(): number {
    return this.conversation.getEstimatedTokens();
  }

  clear(): void {
    this.conversation.clear();
  }

  export(): ConversationMessage[] {
    return this.conversation.export();
  }

  async compact(onEvent?: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
    const history = this.conversation.toLLM().slice(1);
    if (history.length === 0) return;
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
        onDelta: (text) => onEvent?.({ type: "delta", text }),
        onRetry: (attempt, max) => onEvent?.({ type: "retry", attempt, max }),
        onUsage: (promptTokens, completionTokens) => onEvent?.({ type: "usage", promptTokens, completionTokens }),
        signal,
      }), signal);
    } catch (e) {
      if (signal?.aborted) {
        onEvent?.({ type: "interrupted" });
      } else {
        onEvent?.({ type: "error", text: (e as Error).message });
      }
      return;
    }
    this.conversation.compact((msg.content as string) || "");
  }

  async run(
    userInput: string,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.runTurn({ role: "user", content: userInput }, onEvent, signal);
  }

  async runSkill(
    skill: Skill,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    await this.runTurn({ role: "skill", name: skill.name, content: skill.prompt }, onEvent, signal);
  }

  private async runTurn(
    msg: ConversationMessage,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    this.conversation.add(msg);
    this.conversation.createSnapshot();
    this.todoSnapshot = this.getTodos();

    const onAbort = () => {
      this.conversation.restoreFromSnapshot();
      this.setTodos([...this.todoSnapshot]);
      onEvent?.({ type: "interrupted" });
    };

    try {
      await withAbort(this.loop(onEvent, signal), signal);
    } catch {
      if (signal?.aborted) onAbort();
    } finally {
      this.conversation.clearSnapshot();
      this.todoSnapshot = [];
    }
  }

  private async loop(
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    let lastSig = "";
    let stall = 0;
    let turns = 0;
    while (true) {
      if (this.conversation.getEstimatedTokens() > this.compactThreshold) {
        await this.compact(undefined, signal);
      }
      const messages = this.conversation.toLLM();
      const todos = this.getTodos();
      if (todos.length) {
        messages.push({ role: "user", content: renderTodoReminder(todos) });
      }
      let msg: AssistantMessage;
      try {
        msg = await withAbort(this.llm.chat({
          messages,
          tools: this.tools.schemas(),
          onDelta: (text) => onEvent?.({ type: "delta", text }),
          onRetry: (attempt, max) => onEvent?.({ type: "retry", attempt, max }),
          onUsage: (promptTokens, completionTokens) => onEvent?.({ type: "usage", promptTokens, completionTokens }),
          signal,
        }), signal);
      } catch (e) {
        if (signal?.aborted) return;
        onEvent?.({ type: "error", text: (e as Error).message });
        return;
      }
      this.conversation.add(msg);
      if (!msg.tool_calls?.length) return;
      const sig = msg.tool_calls
        .map((c) => `${c.function.name}:${c.function.arguments}`)
        .join("|");
      stall = sig === lastSig ? stall + 1 : 1;
      lastSig = sig;
      if (stall >= this.stallThreshold) {
        onEvent?.({ type: "error", text: `agent stalled: repeated identical tool calls` });
        return;
      }
      if (++turns >= this.maxTurns) {
        onEvent?.({ type: "error", text: `agent exceeded max turns (${this.maxTurns})` });
        return;
      }
      const results = await this.runToolCalls(msg, onEvent, signal);
      if (!results) return;
      for (const r of results) {
        this.conversation.add({ role: "tool", tool_call_id: r.id, content: r.content });
      }
    }
  }

  private async runToolCalls(
    msg: AssistantMessage,
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<{ id: string; content: string }[] | null> {
    return withAbortFallback(Promise.all(
      msg.tool_calls!.map(async (call) => {
        let args: Record<string, unknown> = {};
        let argsError = "";
        if (call.function.arguments) {
          try { args = JSON.parse(call.function.arguments); }
          catch (e) { argsError = `Error: invalid arguments: ${(e as Error).message}`; }
        }
        const summary = this.tools.summarize(call.function.name, args);
        onEvent?.({ type: "tool_start", id: call.id, name: call.function.name, summary });
        const ctx: ToolContext = { signal, cwd: this.cwd, ask: this.ask, setTodos: this.setTodos };
        const result: ToolResult = argsError
          ? { content: argsError, isError: true }
          : await this.tools.execute(call.function.name, args, ctx);
        onEvent?.({ type: "tool_end", id: call.id, result: result.content, isError: result.isError });
        return { id: call.id, content: result.content };
      })
    ), signal, null);
  }
}

function renderTodoReminder(todos: readonly Todo[]): string {
  const lines = todos.map((t) => {
    const mark = t.status === "completed" ? "x" : t.status === "in_progress" ? "o" : " ";
    return `[${mark}] ${t.content}`;
  });
  return `<system-reminder>\nCurrent task list (live state):\n${lines.join("\n")}\n</system-reminder>`;
}
