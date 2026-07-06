import type { Tool } from "../tools/types.js";
import type { MCPServerConfig } from "../config.js";
import { MCPClient } from "./client.js";
import { withTimeout } from "../util/async.js";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT = 30_000;

function fixError(text: string): string {
  return text.startsWith("Error: ") ? text : `Error: ${text}`;
}

export class MCPServers {
  private servers = new Map<string, { status: "connected" | "disabled"; client?: MCPClient; tools: string[] }>();
  private pending = new Set<MCPClient>();
  private disposed = false;
  private errorBuffer: string[] = [];
  onError?: (msg: string) => void;

  report(msg: string): void {
    if (this.onError) this.onError(msg);
    else this.errorBuffer.push(msg);
  }

  flushErrors(): string[] {
    const buf = this.errorBuffer;
    this.errorBuffer = [];
    return buf;
  }

  async connect(mcpServers: Record<string, MCPServerConfig> = {}): Promise<Tool[]> {
    const tools: Tool[] = [];
    await Promise.all(
      Object.entries(mcpServers).map(async ([name, cfg]) => {
        if (this.disposed) return;
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
          this.servers.set(name, { status: "connected", client, tools: mcpTools.map((t) => t.name) });
          for (const t of mcpTools) tools.push(this.adapt(name, client, t));
        } catch (e) {
          client.kill();
          if (!this.disposed) {
            this.servers.set(name, { status: "disabled", tools: [] });
            this.report(`MCP server "${name}" failed: ${(e as Error).message}`);
          }
        } finally {
          this.pending.delete(client);
        }
      }),
    );
    return tools;
  }

  private adapt(server: string, client: MCPClient, tool: MCPTool): Tool {
    return {
      name: `MCP__${server}__${tool.name}`,
      description: tool.description ?? `${server} ${tool.name}`,
      parameters: tool.inputSchema,
      async execute(args, signal) {
        const result = await client.callTool(tool.name, args, signal);
        const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
        return result.isError
          ? { content: fixError(text), isError: true }
          : { content: text || "(no output)" };
      },
    };
  }

  list(): { name: string; status: "connected" | "disabled"; tools: string[] }[] {
    return [...this.servers.entries()].map(([name, s]) => ({ name, status: s.status, tools: s.tools }));
  }

  kill(): void {
    this.disposed = true;
    for (const { client } of this.servers.values()) client?.kill();
    for (const client of this.pending) client.kill();
    this.servers.clear();
    this.pending.clear();
  }
}
