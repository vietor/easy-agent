export const MAX_PROCESS_BUFFER_MB = 10;
export const MAX_WEB_FETCH_MB = 10;
export const MAX_FILE_READ_MB = 20;
export const CALL_TIMEOUT_MS = 300_000;
export const REQUEST_TIMEOUT_MS = 60_000;
export const MCP_CONNECT_TIMEOUT_MS = 30_000;
export const NO_OUTPUT = "(no output)";
export const INTERRUPTED_TOOL_CONTENT = "(interrupted)";
export const NO_MATCHES = "(no matches)";
export const NOT_EXECUTED_PREFIX = "(not executed: ";
export const MAX_SUMMARY_LENGTH = 75;
export const MAX_ARGS_SUMMARY_LENGTH = 300;
export const DEFAULT_STALL_THRESHOLD = 3;
export const DEFAULT_MAX_TURNS = 50;
export const DEFAULT_FILE_READ_LIMIT = 2000;
export const DEFAULT_GREP_LIMIT = 200;
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10;
export const SKILL_TOOL_NAME = "Skill" as const;
export const LLM_MAX_RETRIES = 3;
export const WEB_FETCH_RETRIES = 2;
export const DEFAULT_THINKING_EFFORT = "high" as const;
export const DEFAULT_BACKEND = "completions" as const;
export const DEFAULT_MAX_INPUT_TOKENS = 1_000_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 128_000;

export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}
