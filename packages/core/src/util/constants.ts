export const MAX_PROCESS_BUFFER = 10 * 1024 * 1024;
export const MAX_READ_BYTES = 10 * 1024 * 1024;
// Byte caps are semantically distinct, do not merge: MAX_READ_BYTES bounds the WebFetch body,
// MAX_PROCESS_BUFFER bounds subprocess stdout, MAX_FILE_READ_BYTES (20MB, above both) bounds FileRead file size.
export const MAX_FILE_READ_BYTES = 20_000_000;
export const CALL_TIMEOUT_MS = 300_000;
export const REQUEST_TIMEOUT_MS = 60_000;
export const NO_OUTPUT = "(no output)";
export const NO_MATCHES = "(no matches)";
export const NOT_EXECUTED_PREFIX = "(not executed: ";
export const MAX_PREVIEW_LEN = 75;
export const DEFAULT_STALL_THRESHOLD = 3;
export const DEFAULT_MAX_TURNS = 50;
export const MAX_PARALLEL_TOOL_CALLS = 8;
export const SKILL_TOOL_NAME = "Skill" as const;
