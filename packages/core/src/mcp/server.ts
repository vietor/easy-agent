import type { Tool } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { MCPServerConfig } from "./types.js";
import { MCPClient } from "./client.js";
import { withTimeout } from "../util/async.js";
import type { CallToolResult, Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT = 30_000;

const SUMMARY_PRIORITY = ["url", "path", "file_path", "filePath", "command", "query", "pattern", "name", "text", "selector", "uid"];

function isStringProp(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { type?: unknown }).type === "string";
}

function summaryCandidates(inputSchema: MCPTool["inputSchema"]): string[] {
  const props = inputSchema.properties;
  if (!props) return [];
  const candidates: string[] = [];
  for (const k of SUMMARY_PRIORITY) if (k in props) candidates.push(k);
  const required = inputSchema.required;
  if (Array.isArray(required)) {
    for (const k of required) {
      if (typeof k === "string" && !candidates.includes(k) && isStringProp(props[k])) candidates.push(k);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (!candidates.includes(k) && isStringProp(v)) candidates.push(k);
  }
  return candidates;
}

type ServerType = "stdio" | "http";

function serverType(cfg: MCPServerConfig): ServerType {
  return "command" in cfg ? "stdio" : cfg.type;
}

function fixError(text: string): string {
  return text.startsWith("Error: ") ? text : `Error: ${text}`;
}

function extractContent(result: CallToolResult): string {
  const parts: string[] = [];
  for (const c of result.content) {
    switch (c.type) {
      case "text":
        parts.push(c.text);
        break;
      case "image":
        parts.push(`[image: ${c.mimeType}]`);
        break;
      case "audio":
        parts.push(`[audio: ${c.mimeType}]`);
        break;
      case "resource": {
        const r = c.resource;
        parts.push("text" in r ? r.text : `[resource: ${r.uri}]`);
        break;
      }
      default:
        parts.push(`[${(c as { type: string }).type}]`);
    }
  }
  if (result.structuredContent) {
    parts.push(`<structured>${JSON.stringify(result.structuredContent)}</structured>`);
  }
  return parts.join("\n");
}

export class MCPServers {
  private servers = new Map<string, { type: ServerType; status: "pending" | "connected" | "failed" | "disabled"; client?: MCPClient; tools: string[] }>();
  private pending = new Set<MCPClient>();
  private disposed = false;

  constructor(private tools: ToolRegistry) {}

  async connect(mcpServers: Record<string, MCPServerConfig> = {}): Promise<void> {
    await Promise.all(
      Object.entries(mcpServers).map(async ([name, cfg]) => {
        if (this.disposed) return;
        const type = serverType(cfg);
        if (cfg.enabled === false) {
          this.servers.set(name, { type, status: "disabled", tools: [] });
          return;
        }
        this.servers.set(name, { type, status: "pending", tools: [] });
        const client = new MCPClient(name, cfg);
        this.pending.add(client);
        try {
          await withTimeout(client.connect(), CONNECT_TIMEOUT);
          if (this.disposed) {
            client.kill();
            return;
          }
          const mcpTools = await withTimeout(client.listTools(), CONNECT_TIMEOUT);
          if (this.disposed) {
            client.kill();
            return;
          }
          this.servers.set(name, { type, status: "connected", client, tools: mcpTools.map((t) => t.name) });
          for (const t of mcpTools) this.tools.register(this.adapt(name, client, t));
        } catch (e) {
          client.kill();
          if (!this.disposed) {
            this.servers.set(name, { type, status: "failed", tools: [] });
          }
        } finally {
          this.pending.delete(client);
        }
      }),
    );
  }

  private adapt(server: string, client: MCPClient, tool: MCPTool): Tool {
    const summaryArg = summaryCandidates(tool.inputSchema);
    return {
      name: `MCP__${server}__${tool.name}`,
      description: tool.description ?? `${server} ${tool.name}`,
      parameters: tool.inputSchema,
      ...(summaryArg.length ? { summaryArg } : {}),
      async execute(args, ctx) {
        const result = await client.callTool(tool.name, args, ctx.signal);
        const text = extractContent(result);
        return result.isError
          ? { content: fixError(text), isError: true }
          : { content: text || "(no output)" };
      },
    };
  }

  list(): { name: string; type: ServerType; status: "pending" | "connected" | "failed" | "disabled"; tools: string[] }[] {
    return [...this.servers.entries()].map(([name, s]) => ({ name, type: s.type, status: s.status, tools: s.tools }));
  }

  kill(): void {
    this.disposed = true;
    for (const { client } of this.servers.values()) client?.kill();
    for (const client of this.pending) client.kill();
    this.servers.clear();
    this.pending.clear();
  }
}
