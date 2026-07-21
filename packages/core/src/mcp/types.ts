export interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface RemoteServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type MCPServerConfig = StdioServerConfig | RemoteServerConfig;

export interface MCPServerInfo {
  name: string;
  type: "stdio" | "http";
  status: "pending" | "connected" | "failed" | "disabled";
  tools: string[];
  error?: string;
}
