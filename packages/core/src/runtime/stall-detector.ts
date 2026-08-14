export class StallDetector {
  private lastSig = "";
  private stall = 0;
  private textOnlyStreak = 0;

  noteTextOnly(): number {
    return ++this.textOnlyStreak;
  }

  resetTextOnly(): void {
    this.textOnlyStreak = 0;
  }

  noteToolSig(sig: string): number {
    this.stall = sig === this.lastSig ? this.stall + 1 : 1;
    this.lastSig = sig;
    return this.stall;
  }
}
