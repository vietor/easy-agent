import { rgPath } from "@vscode/ripgrep";
import { runProcess } from "./subprocess.js";
import { NO_MATCHES, REQUEST_TIMEOUT_MS } from "./constants.js";
import { formatCompactNumber, summaryCount } from "./text.js";

const TRUNCATION_MARKER = "(output truncated)";
const BREAKDOWN_DIRS = 40;

export function formatRipgrepOutput(lines: string[], overflow?: string): string {
  if (!lines.length) return NO_MATCHES;
  const out = lines.join("\n");
  return overflow ? out + "\n" + overflow : out;
}

export function overflowNotice(entries: string[], shown: number, word: "file" | "match", breakdown?: string, offset = 0): string {
  const noun = word === "file" ? "files" : "matches";
  const range = offset > 0
    ? `${formatCompactNumber(offset + 1)}-${formatCompactNumber(offset + shown)}`
    : `the first ${formatCompactNumber(shown)}`;
  const head = `${TRUNCATION_MARKER} ${formatCompactNumber(entries.length)} ${noun} in total, showing ${range}`;
  return breakdown ? `${head}\n${breakdown}` : head;
}

export function offsetPastEnd(offset: number): string {
  return `(no entries at offset ${offset} — end of results)`;
}

export function directoryBreakdown(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    const dir = cut < 0 ? "." : path.slice(0, cut);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const shown = ranked.slice(0, BREAKDOWN_DIRS).map(([dir, count]) => `${dir} = ${count}`).join(", ");
  const omitted = ranked.length > BREAKDOWN_DIRS
    ? ` (${BREAKDOWN_DIRS} of ${ranked.length} directories shown, largest first — narrow with path or pattern for the rest)`
    : "";
  return `by directory: ${shown}${omitted}`;
}

function listedLineCount(content: string): number {
  let count = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith(TRUNCATION_MARKER)) break;
    if (line) count++;
  }
  return count;
}

export function ripgrepResultSummary(word: "file" | "match", result: { content: string; isError?: boolean }, failText: string): string {
  if (result.isError) return failText;
  if (result.content === NO_MATCHES) return summaryCount(word, 0);
  return summaryCount(word, listedLineCount(result.content));
}

interface RipgrepLinesResult {
  lines: string[];
  truncated: boolean;
  all: string[];
}

export function renderListing(
  result: RipgrepLinesResult,
  word: "file" | "match",
  census: string | undefined,
  offset: number
): string {
  if (offset > 0 && result.lines.length === 0) return offsetPastEnd(offset);
  if (!result.truncated) return formatRipgrepOutput(result.lines);
  return formatRipgrepOutput(result.lines, overflowNotice(result.all, result.lines.length, word, census, offset));
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
