import { z } from "zod";

export interface MCPClientInfo {
  name: string;
  version: string;
}

export const MCPServerConfigSchema = z.union([
  z.object({
    type: z.literal("stdio").default("stdio"),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("http"),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
  }),
]);

export type MCPServerConfig = z.input<typeof MCPServerConfigSchema>;

export type ResolvedMCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export type MCPServerType = ResolvedMCPServerConfig["type"];

export interface MCPServerInfo {
  name: string;
  type: MCPServerType;
  status: "pending" | "connected" | "failed" | "disabled";
  tools: string[];
  error?: string;
}
