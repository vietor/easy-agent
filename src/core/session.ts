import type { Message } from "../llm/types.js";

export class Session {
  messages: Message[] = [];
  private checkpoint?: Message[];

  constructor(private system: string) {
    this.messages.push({ role: "system", content: system });
  }

  add(msg: Message): void {
    this.messages.push(msg);
  }

  export(): Message[] {
    return this.messages.slice(1);
  }

  clear(): void {
    this.messages = [{ role: "system", content: this.system }];
  }

  compact(summary: string): void {
    this.messages = [
      { role: "system", content: this.system },
      { role: "assistant", content: summary },
    ];
  }

  createCheckpoint(): void {
    this.checkpoint = this.messages.slice();
  }

  restoreCheckpoint(): void {
    this.messages = this.checkpoint!.slice();
  }

  removeCheckpoint(): void {
    this.checkpoint = undefined;
  }
}
