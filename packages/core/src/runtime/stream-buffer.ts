export class StreamBuffer {
  private streamingText = "";
  private thinkingText = "";
  private replyStart: number | null = null;
  private lastReplyText = "";

  get reply(): string {
    return this.lastReplyText;
  }

  get firstReplyAt(): number | null {
    return this.replyStart;
  }

  begin(): void {
    this.streamingText = "";
    this.thinkingText = "";
    this.replyStart = null;
    this.lastReplyText = "";
  }

  push(text: string): void {
    if (this.replyStart === null) this.replyStart = Date.now();
    this.streamingText += text;
  }

  pushThinking(text: string): void {
    this.thinkingText += text;
  }

  flush(): { assistant: string | null; thinkingCleared: boolean } {
    const assistant = this.flushAssistant();
    const thinkingCleared = this.flushThinking();
    return { assistant, thinkingCleared };
  }

  flushForRetry(): { thinkingCleared: boolean } {
    this.streamingText = "";
    return { thinkingCleared: this.flushThinking() };
  }

  interrupt(): boolean {
    this.lastReplyText = this.streamingText;
    this.streamingText = "";
    return this.flushThinking();
  }

  flushThinking(): boolean {
    if (!this.thinkingText) return false;
    this.thinkingText = "";
    return true;
  }

  private flushAssistant(): string | null {
    if (!this.streamingText) return null;
    this.lastReplyText = this.streamingText;
    const text = this.streamingText;
    this.streamingText = "";
    return text;
  }
}
