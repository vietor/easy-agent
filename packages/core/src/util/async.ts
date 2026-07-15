export interface RetryOptions {
  retries: number;
  retryable: (e: unknown) => boolean;
  backoff: (attempt: number) => number;
  onRetry?: (attempt: number, max: number) => void;
  signal?: AbortSignal;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < opts.retries && opts.retryable(e)) {
        opts.onRetry?.(attempt + 1, opts.retries);
        await trySleep(opts.backoff(attempt), opts.signal);
        continue;
      }
      throw e;
    }
  }
}

function trySleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timed,
  ]);
}

export function withAbortFallback<T>(promise: Promise<T>, signal: AbortSignal | undefined, fallback: T): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(fallback);
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      signal.addEventListener("abort", () => resolve(fallback), { once: true });
    }),
  ]);
}

export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
