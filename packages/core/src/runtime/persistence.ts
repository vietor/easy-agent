import type { ConversationMessage } from "./conversation.js";
import type { Todo } from "../tools/types.js";

export interface SessionData {
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
  load(sessionId: string): Promise<SessionData | null>;
  saveAll(sessionId: string, state: SessionData): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  delete?(sessionId: string): Promise<void>;
}
