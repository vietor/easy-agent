export type MCPServerConfig = StdioServerConfig | RemoteServerConfig;

export interface StdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean; // set false to skip this server
}

export interface RemoteServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPServerInfo {
  name: string;
  type: "stdio" | "http";
  status: "pending" | "connected" | "failed" | "disabled";
  tools: string[];
  error?: string;
}
