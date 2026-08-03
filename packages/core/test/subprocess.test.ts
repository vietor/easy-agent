import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killProcessTree, runProcess } from "../src/util/subprocess.js";
import { waitUntil } from "./helpers.js";

const isWin = process.platform === "win32";

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

test("killProcessTree kills a direct process (no group)", async () => {
  const child = isWin
    ? spawn("cmd.exe", ["/c", "ping", "-t", "127.0.0.1"], { stdio: "ignore" })
    : spawn("sleep", ["100"], { stdio: "ignore" });
  child.on("error", () => {});
  const pid = child.pid;
  try {
    assert.ok(pid && pid > 0);
    assert.ok(await waitUntil(() => pidAlive(pid!), 5000), "process must be running");
    killProcessTree(pid!);
    assert.ok(
      await waitUntil(() => !pidAlive(pid!), 5000),
      "process must die after killProcessTree"
    );
  } finally {
    if (pid && pidAlive(pid)) {
      if (isWin) {
        try { spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }); } catch {}
      } else {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
  }
});

test("output overflow settles promptly with partial output flagged truncated", async () => {
  const r = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(12 * 1024 * 1024))"], {});
  assert.equal(r.truncated, true, "overflow must be flagged truncated");
  assert.ok(r.error, "overflow must report an error");
  assert.match(r.error!.message, /exceeded/);
  assert.equal(r.status, null);
  assert.ok(r.stdout.length > 0, "partial output must be preserved");
});

test("killProcessTree escalates to SIGKILL when SIGTERM is ignored", { skip: isWin ? "POSIX only" : false }, async () => {
  const child = spawn("/bin/sh", ["-c", "trap '' TERM; exec sleep 100"], { stdio: "ignore" });
  child.on("error", () => {});
  const pid = child.pid;
  try {
    assert.ok(pid && pid > 0);
    assert.ok(await waitUntil(() => pidAlive(pid!), 5000), "process must be running");
    killProcessTree(pid!);
    assert.ok(
      await waitUntil(() => !pidAlive(pid!), 8000),
      "process must die via SIGKILL escalation after SIGTERM was ignored"
    );
  } finally {
    if (pid && pidAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
});
