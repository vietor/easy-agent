import type { ConversationMessage } from "./core/conversation.js";
import type { Todo } from "./tools/types.js";

export interface SessionState {
  messages: ConversationMessage[];
  todos: Todo[];
}

export interface SessionMeta {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
}

export interface SessionPersistence {
  load(sessionId: string): Promise<SessionState | null>;
  saveAll(sessionId: string, state: SessionState): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  delete?(sessionId: string): Promise<void>;
}
