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
  private listeners = new Set<() => void>();

  getSnapshot = (): LogEntry[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  append(entry: LogEntry): void {
    this.entries = [...this.entries, entry];
    this.emit();
  }

  clear(): void {
    this.entries = [];
    this.emit();
  }

  setToolResult(id: string, result: string, isError?: boolean): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry.kind === "tool" && entry.id === id && entry.result === null) {
        const copy = [...this.entries];
        copy[i] = { ...entry, result, isError };
        this.entries = copy;
        this.emit();
        return;
      }
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
