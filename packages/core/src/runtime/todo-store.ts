import type { Todo } from "../tools/types.js";
import { Emitter } from "../util/emitter.js";

export class TodoStore {
  private listeners = new Emitter();
  private items: Todo[] = [];

  get all(): readonly Todo[] {
    return this.items;
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.subscribe(listener);
  }

  set(todos: Todo[]): void {
    this.items = todos;
    this.listeners.notify();
  }
}
