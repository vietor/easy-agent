import type { Message } from "./llm/types.js";

export class Session {
  messages: Message[] = [];

  constructor(system: string) {
    this.messages.push({ role: "system", content: system });
  }

  add(msg: Message): void {
    this.messages.push(msg);
  }
}
