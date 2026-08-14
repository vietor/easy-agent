export class QuestionQueue {
  private questionSeq = 0;
  private resolvers = new Map<string, (answer: string) => void>();

  ask(): { id: string; promise: Promise<string> } {
    const id = `q${++this.questionSeq}`;
    const promise = new Promise<string>((resolve) => {
      this.resolvers.set(id, resolve);
    });
    return { id, promise };
  }

  submit(id: string, answer: string): void {
    const resolve = this.resolvers.get(id);
    if (resolve) {
      this.resolvers.delete(id);
      resolve(answer);
    }
  }

  resolveAll(answer: string): string[] {
    const ids = [...this.resolvers.keys()];
    for (const id of ids) {
      this.submit(id, answer);
    }
    return ids;
  }
}
