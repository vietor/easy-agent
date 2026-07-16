import type { ConversationMessage } from "./core/conversation.js";
import type { Todo } from "./tools/types.js";

export interface SessionState {
  messages: ConversationMessage[];
  todos: Todo[];
}

export interface SessionPersistence {
  load(sessionId: string): SessionState | null;
  saveAll(sessionId: string, state: SessionState): void;
  listSessions(): { id: string; mtime: number }[];
}
