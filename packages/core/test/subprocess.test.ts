import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "../src/util/subprocess.js";

const isWin = process.platform === "win32";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(fn: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

async function readPid(path: string): Promise<number | null> {
  try {
    const n = parseInt((await readFile(path, "utf-8")).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("abort kills the whole process tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "proc-tree-"));
  const pidFile = join(dir, "pid");
  const controller = new AbortController();
  let grandchild: number | null = null;
  try {
    // the direct child spawns a grandchild, reports its pid, then stays alive
    const cmd = isWin
      ? [
          "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
          `$p = Start-Process -PassThru cmd -ArgumentList '/c','ping -t 127.0.0.1'; $p.Id | Out-File -Encoding ascii '${pidFile}'; Start-Sleep -Seconds 30`,
        ]
      : ["/bin/sh", "-c", `sleep 100 & echo $! > "${pidFile}"; wait`];
    const run = runProcess(cmd[0], cmd.slice(1), { cwd: process.cwd() }, controller.signal);

    assert.ok(
      await waitUntil(async () => (await readPid(pidFile)) !== null, 5000),
      "grandchild pid must be reported"
    );
    grandchild = await readPid(pidFile);
    assert.ok(grandchild && grandchild > 0);

    controller.abort();
    await run;
    assert.ok(
      await waitUntil(() => !pidAlive(grandchild!), 5000),
      "grandchild must not survive the abort"
    );
  } finally {
    if (grandchild && pidAlive(grandchild)) {
      if (isWin) {
        try { spawnSync("taskkill", ["/PID", String(grandchild), "/T", "/F"], { windowsHide: true }); } catch {}
      } else {
        try { process.kill(grandchild, "SIGKILL"); } catch {}
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
});
