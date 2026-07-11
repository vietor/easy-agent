import { spawn } from "node:child_process";

const MAX_BUFFER = 10 * 1024 * 1024;

export interface ProcessResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}

export function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
  signal?: AbortSignal
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const onAbort = () => child.kill();
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    }
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    child.stdout?.on("data", (c: Buffer) => {
      outChunks.push(c);
      size += c.length;
      if (size > MAX_BUFFER) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr?.on("data", (c: Buffer) => {
      errChunks.push(c);
    });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ stdout: "", stderr: "", status: null, error });
    });
    child.on("close", (status) => {
      signal?.removeEventListener("abort", onAbort);
      const stdout = Buffer.concat(outChunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      resolve(
        overflow
          ? { stdout, stderr, status, error: new Error("output exceeded maxBuffer") }
          : { stdout, stderr, status }
      );
    });
  });
}
