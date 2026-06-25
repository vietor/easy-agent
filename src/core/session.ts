import type { Message } from "../llm/types.js";

export class Session {
  messages: Message[] = [];

  constructor(private system: string) {
    this.messages.push({ role: "system", content: system });
  }

  add(msg: Message): void {
    this.messages.push(msg);
  }

  clear(): void {
    this.messages = [{ role: "system", content: this.system }];
  }
}
