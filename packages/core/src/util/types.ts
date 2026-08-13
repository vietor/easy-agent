export interface TextResult {
  content: string;
  isError?: boolean;
}

export interface ClientInfo {
  name: string;
  version: string;
}

export function toolError(msg: string): TextResult {
  const content = msg.startsWith("Error: ") ? msg : `Error: ${msg}`;
  return { content: content, isError: true };
}
