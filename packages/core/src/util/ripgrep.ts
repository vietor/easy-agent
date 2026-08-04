import { rgPath } from "@vscode/ripgrep";
import { runProcess } from "./subprocess.js";
import { NO_MATCHES, REQUEST_TIMEOUT_MS } from "./constants.js";
import { TRUNCATION_MARKER, previewCount, visibleLineCount } from "./text.js";

export interface RgOutput {
  content: string;
  isError?: boolean;
}

export function formatRgOutput(lines: string[], truncated: boolean, emptyText: string): string {
  if (!lines.length) return emptyText;
  const out = lines.join("\n");
  return truncated ? out + "\n" + TRUNCATION_MARKER : out;
}

export function rgResultPreview(word: "file" | "match", result: RgOutput, failText: string, noMatchesText: string): string {
  if (result.isError) return failText;
  if (result.content === NO_MATCHES) return noMatchesText;
  return previewCount(word, visibleLineCount(result.content), false, failText);
}

export interface RgLinesResult {
  lines: string[];
  truncated: boolean;
}

export async function runRgLines(args: string[], cwd: string, signal?: AbortSignal, limit?: number): Promise<RgLinesResult> {
  const rgArgs = ["--hidden", "--path-separator", "/", "-g", "!.git/**", "-g", "!node_modules/**", ...args];
  const r = await runProcess(rgPath, rgArgs, { cwd, timeout: REQUEST_TIMEOUT_MS }, signal);
  if (!r.truncated && (r.error || (r.status !== 0 && r.status !== 1))) {
    throw r.error ?? new Error((r.stderr || "").trim() || `ripgrep exited with ${r.status}`);
  }
  let kept = r.stdout.split("\n").filter(Boolean);
  let truncated = r.truncated === true;
  if (limit !== undefined && kept.length > limit) {
    kept = kept.slice(0, limit);
    truncated = true;
  }
  return { lines: kept.map((f) => f.replace(/^\.\//, "")), truncated };
}
