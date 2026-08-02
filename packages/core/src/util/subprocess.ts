import { spawn, spawnSync } from "node:child_process";
import { MAX_PROCESS_BUFFER } from "./constants.js";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}

/** Kill a process — with group: true, the whole tree via the process group (child.kill() alone leaves grandchildren running). Never throws. */
export function killProcessTree(pid: number | null | undefined, opts?: { group?: boolean }): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {}
  } else if (opts?.group) {
    // the child is spawned detached, i.e. process-group leader; -pid signals the whole group
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
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
    let overflow = false;
    let settled = false;

    function settle(result: ProcessResult) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve(result);
    }

    function kill() { killProcessTree(child.pid, { group: true }); }

    if (signal) {
      signal.addEventListener("abort", kill, { once: true });
      if (signal.aborted) kill();
    }
    // pid is undefined until the child has spawned, so an abort before that
    // point leaves kill() a no-op; re-check once the process exists
    child.on("spawn", () => {
      if (signal?.aborted) kill();
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const { timeout } = opts;
    if (timeout && timeout > 0) {
      timer = setTimeout(() => {
        kill();
        settle({
          stdout: Buffer.concat(outChunks).toString("utf-8"),
          stderr: Buffer.concat(errChunks).toString("utf-8"),
          status: null,
          error: new Error(`Command timed out (${timeout / 1000}s)`),
        });
      }, timeout);
    }

    child.stdout?.on("data", (c: Buffer) => {
      outChunks.push(c);
      size += c.length;
      if (size > MAX_PROCESS_BUFFER) { overflow = true; kill(); }
    });
    child.stderr?.on("data", (c: Buffer) => {
      errChunks.push(c);
      size += c.length;
      if (size > MAX_PROCESS_BUFFER) { overflow = true; kill(); }
    });
    child.on("error", (error) => settle({ stdout: "", stderr: "", status: null, error }));
    child.on("close", (status) => {
      const stdout = Buffer.concat(outChunks).toString("utf-8");
      const stderr = Buffer.concat(errChunks).toString("utf-8");
      settle(overflow
        ? { stdout, stderr, status, error: new Error(`Command output exceeded ${MAX_PROCESS_BUFFER / 1024 / 1024}MB`) }
        : { stdout, stderr, status });
    });
  });
}
