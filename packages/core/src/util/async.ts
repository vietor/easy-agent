export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

export function isAbortError(e: unknown): boolean {
  if (e instanceof AbortedError) return true;
  return (e as { name?: string } | undefined)?.name === "AbortError";
}

export function backoffDelay(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 60_000);
}

export interface RetryOptions {
  retries: number;
  retryable: (e: unknown) => boolean;
  backoff: (attempt: number) => number;
  onRetry?: (attempt: number, max: number, error: unknown) => void;
  signal?: AbortSignal;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < opts.retries && opts.retryable(e)) {
        opts.onRetry?.(attempt + 1, opts.retries, e);
        await trySleep(opts.backoff(attempt), opts.signal);
        continue;
      }
      throw e;
    }
  }
}

function trySleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function withTimeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

export function isTimeout(signal: AbortSignal): boolean {
  return (signal.reason as { name?: string })?.name === "TimeoutError";
}

export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal, onAbort?: () => T): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return onAbort ? Promise.resolve(onAbort()) : Promise.reject(new AbortedError());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => { if (onAbort) resolve(onAbort()); else reject(new AbortedError()); };
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", handleAbort));
  });
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const completed: Array<{ index: number; value: R }> = [];
  const size = Math.min(Math.max(1, limit), items.length);
  let next = 0;
  let failure: { index: number; error: unknown } | undefined;
  const record = (index: number, error: unknown): void => {
    if (!failure || index < failure.index) failure = { index, error };
  };
  const worker = async (): Promise<void> => {
    while (!failure) {
      if (signal?.aborted) return;
      const index = next++;
      if (index >= items.length) return;
      try {
        completed.push({ index, value: await fn(items[index]) });
      } catch (error) {
        record(index, error);
      }
    }
  };
  await Promise.all(Array.from({ length: size }, () => worker()));
  if (failure) throw failure.error;
  completed.sort((a, b) => a.index - b.index);
  return completed.map((r) => r.value);
}

export async function withTimeoutFn<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  signal: AbortSignal | undefined,
  timeoutMessage: string,
  otherError?: (e: unknown) => unknown
): Promise<T> {
  const timed = withTimeoutSignal(signal, ms);
  try {
    return await fn(timed);
  } catch (e) {
    if (isTimeout(timed)) throw new Error(timeoutMessage);
    throw otherError ? otherError(e) : e;
  }
}
