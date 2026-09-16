import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SPOOL_MAX_BYTES, SPOOL_RETENTION_MS } from "./constants.js";

interface Entry {
  path: string;
  mtime: number;
  size: number;
}

export async function cleanupSpoolDir(dir: string, keep?: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - SPOOL_RETENTION_MS;
  const kept: Entry[] = [];
  let total = 0;
  for (const name of names) {
    if (name === keep) continue;
    const path = join(dir, name);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (info.mtimeMs < cutoff) {
        await unlink(path).catch(() => {});
        continue;
      }
      kept.push({ path, mtime: info.mtimeMs, size: info.size });
      total += info.size;
    } catch {}
  }
  if (total <= SPOOL_MAX_BYTES) return;
  kept.sort((a, b) => a.mtime - b.mtime);
  for (const entry of kept) {
    if (total <= SPOOL_MAX_BYTES) return;
    try {
      await unlink(entry.path);
      total -= entry.size;
    } catch {}
  }
}
