import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mapWithConcurrency } from "./async.js";
import { DIR_MAX_BYTES, DIR_RETENTION_MS, DIR_SWEEP_CONCURRENCY } from "./constants.js";

interface Entry {
  path: string;
  mtime: number;
  size: number;
}

export async function sweepDir(dir: string, keep?: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - DIR_RETENTION_MS;
  const kept = (
    await mapWithConcurrency(names, DIR_SWEEP_CONCURRENCY, async (name): Promise<Entry | undefined> => {
      if (name === keep) return undefined;
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (!info.isFile()) return undefined;
        if (info.mtimeMs < cutoff) {
          await unlink(path).catch(() => {});
          return undefined;
        }
        return { path, mtime: info.mtimeMs, size: info.size };
      } catch {
        return undefined;
      }
    })
  ).filter((entry) => entry !== undefined);
  let total = kept.reduce((sum, entry) => sum + entry.size, 0);
  if (total <= DIR_MAX_BYTES) return;
  kept.sort((a, b) => a.mtime - b.mtime);
  for (const entry of kept) {
    if (total <= DIR_MAX_BYTES) return;
    try {
      await unlink(entry.path);
      total -= entry.size;
    } catch {}
  }
}
