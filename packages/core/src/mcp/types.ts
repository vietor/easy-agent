import { z } from "zod";

const stdioServerConfigSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

const remoteServerConfigSchema = z.object({
  type: z.enum(["http"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const mcpServerConfigSchema = z.union([stdioServerConfigSchema, remoteServerConfigSchema]);

export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>;

export interface MCPServerInfo {
  name: string;
  type: "stdio" | "http";
  status: "pending" | "connected" | "failed" | "disabled";
  tools: string[];
  error?: string;
}
