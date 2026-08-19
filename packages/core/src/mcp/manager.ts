import type { Tool } from "../tools/types.js";
import { toolError } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { MCPClientInfo, MCPServerConfig, MCPServerInfo, ServerType } from "./types.js";
import { MCPClient } from "./client.js";
import { withTimeout, withTimeoutFn } from "../util/async.js";
import { CALL_TIMEOUT_MS, MCP_CONNECT_TIMEOUT_MS, NO_OUTPUT } from "../util/constants.js";
import { toErrorMessage } from "../util/text.js";
import type { CallToolResult, Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

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

function mcpToolName(server: string, tool: string): string {
  return `MCP__${server}__${tool}`;
}

interface ServerEntry {
  type: ServerType;
  status: MCPServerInfo["status"];
  client?: MCPClient;
  tools: string[];
  error?: string;
}

export class MCPServerManager {
  private servers = new Map<string, ServerEntry>();
  private pending = new Set<MCPClient>();
  private disposed = false;

  constructor(
    private tools: ToolRegistry,
    private clientInfo: MCPClientInfo,
  ) {}

  async connect(mcpServers: Record<string, MCPServerConfig> = {}): Promise<void> {
    await Promise.all(
      Object.entries(mcpServers).map(([name, cfg]) => this.connectServer(name, cfg)),
    );
  }

  private async connectServer(name: string, cfg: MCPServerConfig): Promise<void> {
    if (this.disposed) return;
    const type = cfg.type;
    if (cfg.enabled === false) {
      this.servers.set(name, { type, status: "disabled", tools: [] });
      return;
    }
    this.servers.set(name, { type, status: "pending", tools: [] });
    let client: MCPClient;
    try {
      client = new MCPClient(cfg, this.clientInfo);
    } catch (e) {
      this.markFailed(name, type, toErrorMessage(e));
      return;
    }
    this.pending.add(client);
    try {
      await withTimeout(client.connect(), MCP_CONNECT_TIMEOUT_MS);
      if (this.disposed) return;
      const mcpTools = await withTimeout(client.listTools(), MCP_CONNECT_TIMEOUT_MS);
      if (this.disposed) return;
      this.servers.set(name, { type, status: "connected", client, tools: mcpTools.map((t) => t.name) });
      this.tools.registerAll(mcpTools.map((t) => this.adapt(name, client, t)));
      client.onClosed = (error) => this.handleServerClosed(name, client, error);
    } catch (e) {
      client.kill();
      if (!this.disposed) {
        this.markFailed(name, type, toErrorMessage(e));
      }
    } finally {
      this.pending.delete(client);
    }
  }

  private markFailed(name: string, type: ServerType, error: string): void {
    this.servers.set(name, { type, status: "failed", tools: [], error });
  }

  private unregisterServerTools(name: string, tools: string[]): void {
    for (const t of tools) this.tools.unregister(mcpToolName(name, t));
  }

  private handleServerClosed(name: string, client: MCPClient, error?: string): void {
    const entry = this.servers.get(name);
    if (!entry || entry.client !== client || entry.status !== "connected") return;
    this.unregisterServerTools(name, entry.tools);
    this.markFailed(name, entry.type, error ?? "MCP server connection closed");
  }

  private adapt(server: string, client: MCPClient, tool: MCPTool): Tool {
    const argSummaryKeys = summaryCandidates(tool.inputSchema);
    return {
      name: mcpToolName(server, tool.name),
      description: tool.description ?? `${server} ${tool.name}`,
      parameters: tool.inputSchema,
      ...(argSummaryKeys.length ? { argSummaryKeys } : {}),
      async execute(args, ctx) {
        const result = await withTimeoutFn(
          (signal) => client.callTool(tool.name, args, signal),
          CALL_TIMEOUT_MS,
          ctx.signal,
          `MCP tool call timed out (${CALL_TIMEOUT_MS / 1000}s)`
        );
        const text = extractContent(result);
        return result.isError
          ? toolError(text)
          : { content: text || NO_OUTPUT };
      },
    };
  }

  list(): MCPServerInfo[] {
    return [...this.servers.entries()].map(([name, s]) => ({ name, type: s.type, status: s.status, tools: s.tools, error: s.error }));
  }

  kill(): void {
    this.disposed = true;
    for (const { client } of this.servers.values()) client?.kill();
    for (const client of this.pending) client.kill();
    this.servers.clear();
    this.pending.clear();
  }
}
