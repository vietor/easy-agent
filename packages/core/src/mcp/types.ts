export interface MCPClientInfo {
  name: string;
  version: string;
}

export type ServerType = "stdio" | "http";

export type MCPServerConfig = StdioServerConfig | HttpServerConfig;

export interface StdioServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface HttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPServerInfo {
  name: string;
  type: ServerType;
  status: "pending" | "connected" | "failed" | "disabled";
  tools: string[];
  error?: string;
}
