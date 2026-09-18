import { rgPath } from "@vscode/ripgrep";
import { runProcess } from "./subprocess.js";
import { NO_MATCHES, REQUEST_TIMEOUT_MS } from "./constants.js";
import { formatCompactNumber, summaryCount } from "./text.js";

const TRUNCATION_MARKER = "(output truncated)";
const BREAKDOWN_DIRS = 12;

export function formatRipgrepOutput(lines: string[], truncated: boolean, emptyText: string, overflow?: string): string {
  if (!lines.length) return emptyText;
  const out = lines.join("\n");
  if (!truncated) return out;
  return out + "\n" + (overflow ?? TRUNCATION_MARKER);
}

export function overflowNotice(entries: string[], shown: number, word: "file" | "match", breakdown?: string): string {
  const head = `${TRUNCATION_MARKER} ${formatCompactNumber(entries.length)} ${word === "file" ? "files" : "matches"} in total, showing the first ${formatCompactNumber(shown)}`;
  return breakdown ? `${head}\n${breakdown}` : head;
}

export function directoryBreakdown(paths: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    const dir = cut < 0 ? "." : path.slice(0, cut);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  if (counts.size < 2) return undefined;
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).slice(0, BREAKDOWN_DIRS);
  return `by directory: ${ranked.map(([dir, count]) => `${dir} = ${count}`).join(", ")}`;
}

function listedLineCount(content: string): number {
  let count = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith(TRUNCATION_MARKER)) break;
    if (line) count++;
  }
  return count;
}

export function ripgrepResultSummary(word: "file" | "match", result: { content: string; isError?: boolean }, failText: string, noMatchesText: string): string {
  if (result.isError) return failText;
  if (result.content === NO_MATCHES) return noMatchesText;
  return summaryCount(word, listedLineCount(result.content));
}

interface RipgrepLinesResult {
  lines: string[];
  truncated: boolean;
  all: string[];
}

export async function runRipgrepLines(args: string[], cwd: string, signal?: AbortSignal, limit?: number, offset = 0): Promise<RipgrepLinesResult> {
  const rgArgs = ["--hidden", "--path-separator", "/", "-g", "!.git/**", "-g", "!node_modules/**", ...args];
  const r = await runProcess(rgPath, rgArgs, { cwd, timeout: REQUEST_TIMEOUT_MS }, signal);
  if (!r.truncated && (r.error || (r.status !== 0 && r.status !== 1))) {
    throw r.error ?? new Error((r.stderr || "").trim() || `ripgrep exited with ${r.status}`);
  }
  const all = r.stdout.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
  let truncated = r.truncated === true;
  let lines = offset > 0 ? all.slice(offset) : all;
  if (limit !== undefined && lines.length > limit) {
    lines = lines.slice(0, limit);
    truncated = true;
  }
  return { lines, truncated, all };
}
