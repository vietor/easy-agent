export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function waitUntil(fn: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}
