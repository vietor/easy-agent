export type LogEntry =
  | { kind: "user"; text: string }
  | { kind: "skill"; name: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; summary: string; result: string | null; isError?: boolean }
  | { kind: "retry"; attempt: number; max: number }
  | { kind: "error"; text: string }
  | { kind: "interrupted" }
  | { kind: "system"; text: string };

export class LogStore {
  private entries: LogEntry[] = [];
  private version = 0;
  private listeners = new Set<() => void>();

  getSnapshot = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get all(): readonly LogEntry[] {
    return this.entries;
  }

  append(entry: LogEntry): void {
    this.entries.push(entry);
    this.version++;
    this.emit();
  }

  setResult(id: string, result: string, isError?: boolean): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.kind === "tool" && entry.id === id && entry.result === null) {
        this.entries[i] = { ...entry, result, isError };
        this.version++;
        this.emit();
        return;
      }
    }
  }

  clear(): void {
    this.entries = [];
    this.version++;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
