import { runProcess } from "../util/subprocess.js";
import { CALL_TIMEOUT_MS, NO_OUTPUT } from "../util/constants.js";
import type { Tool } from "./types.js";
import { toolError } from "../util/types.js";
import { summaryBytes } from "../util/text.js";

const isWindows = process.platform === "win32";
const shell = isWindows ? "powershell.exe" : (process.env.SHELL || "/bin/bash");
const shellArgs = isWindows ? ["-NoProfile", "-NonInteractive", "-Command"] : ["-c"];
const commandPrefix = isWindows
  ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; "
  : "";

const PRIVILEGED_RE = /(^|[;&|()`\n])\s*(?:(?:env|command|xargs)\s+)?(sudo|su|doas|pkexec)\b/;

const DESCRIPTION_POWERSHELL = `
Windows PowerShell 5.1 (powershell.exe — NOT pwsh/bash).

WARNING — four common mistakes:
• QUOTE unquoted args starting with a single - that contain a dot — splits them at the last dot (or use --%).
  Example: -DoutputFile=dep.txt → "-DoutputFile=dep" + ".txt" → fails; use "-DoutputFile=dep.txt"
  Safe unquoted: --key=value, plain paths, dotless values.
• Use ; not &&/|| to chain commands
• Use \` (backtick) to escape, not \\
• Use $env:NAME, not $NAME

QUOTING: '...' literal. "..." expands $var, $env:NAME, $(...).
SYNTAX: Conditional: if ($?) { }. No heredocs (<<) or background (&).
LIMITATIONS: No stdin. Long-running killed at timeout.
`;

const DESCRIPTION_BASH = `
Execute a bash command.

QUOTING: Always double-quote: "$FILE" not $FILE.
LIMITATIONS: Blocked: direct sudo/su/doas/pkexec (best-effort; indirect invocation may bypass). No stdin. Long-running killed at timeout.
`;

export const shellTool: Tool = {
  name: "Shell",
  description: isWindows? DESCRIPTION_POWERSHELL: DESCRIPTION_BASH,
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute(args, ctx) {
    const command = args.command as string;
    if (!isWindows && PRIVILEGED_RE.test(command)) {
      return toolError("privileged commands (sudo/su/doas/pkexec) are not allowed");
    }
    const r = await runProcess(shell, [...shellArgs, commandPrefix + command], { cwd: ctx.cwd, timeout: CALL_TIMEOUT_MS }, ctx.signal);
    if (r.status === 0 && !r.error) {
      return { content: r.stdout || NO_OUTPUT };
    }
    const parts = [r.stdout, r.stderr, r.error?.message].filter(Boolean);
    return toolError(parts.join("\n") || NO_OUTPUT);
  },
  summarizeResult(result) {
    return summaryBytes("Command executed", result, "Command failed");
  },
  summaryKeys: ["command"],
};
