import { spawn, spawnSync } from "node:child_process";
import { MAX_PROCESS_BUFFER_MB, mbToBytes } from "./constants.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
  truncated?: boolean;
}

const KILL_GRACE_MS = 2000;
const MAX_PROCESS_BUFFER = mbToBytes(MAX_PROCESS_BUFFER_MB);

const liveProcesses = new Set<number>();
process.on("exit", () => {
  for (const pid of liveProcesses) killProcessTree(pid, { group: true, force: true });
});

export function killProcessTree(pid: number | null | undefined, opts?: { group?: boolean; force?: boolean }): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {}
    return;
  }
  const targets = opts?.group ? [-pid, pid] : [pid];
  for (const target of targets) {
    try {
      process.kill(target, opts?.force ? "SIGKILL" : "SIGTERM");
      if (!opts?.force) scheduleSIGKILL(target);
      return;
    } catch {}
  }
}

function scheduleSIGKILL(pid: number): void {
  setTimeout(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }, KILL_GRACE_MS).unref();
}

export function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeout?: number } = {},
  signal?: AbortSignal
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    function flushOutput(): { stdout: string; stderr: string } {
      return {
        stdout: Buffer.concat(outChunks).toString("utf-8"),
        stderr: Buffer.concat(errChunks).toString("utf-8"),
      };
    }

    function settle(result: ProcessResult) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve(result);
    }

    function kill() { killProcessTree(child.pid, { group: true }); }

    function onChunk(c: Buffer, chunks: Buffer[]) {
      if (settled) return;
      chunks.push(c);
      size += c.length;
      if (size > MAX_PROCESS_BUFFER) {
        kill();
        settle({
          ...flushOutput(),
          status: null,
          error: new Error(`Command output exceeded ${MAX_PROCESS_BUFFER_MB}MB`),
          truncated: true,
        });
      }
    }

    if (signal) {
      signal.addEventListener("abort", kill, { once: true });
      if (signal.aborted) kill();
    }
    child.on("spawn", () => {
      liveProcesses.add(child.pid!);
      if (signal?.aborted) kill();
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const { timeout } = opts;
    if (timeout && timeout > 0) {
      timer = setTimeout(() => {
        kill();
        settle({
          ...flushOutput(),
          status: null,
          error: new Error(`Command timed out (${timeout / 1000}s)`),
        });
      }, timeout);
    }

    child.stdout?.on("data", (c: Buffer) => onChunk(c, outChunks));
    child.stderr?.on("data", (c: Buffer) => onChunk(c, errChunks));
    child.on("error", (error) => settle({ stdout: "", stderr: "", status: null, error }));
    child.on("close", (status) => {
      liveProcesses.delete(child.pid!);
      if (settled) return;
      settle({ ...flushOutput(), status });
    });
  });
}
