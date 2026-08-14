export class Emitter<T extends (...args: any[]) => void = () => void> {
  private listeners = new Set<T>();

  subscribe(listener: T): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(...args: Parameters<T>): void {
    for (const l of this.listeners) {
      try { l(...args); } catch { /* isolate listener errors */ }
    }
  }
}
