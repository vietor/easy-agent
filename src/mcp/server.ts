import type { Tool } from "../tools/types.js";
import type { MCPServerConfig } from "../config.js";
import { MCPClient } from "./client.js";
import { withTimeout } from "../util/async.js";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT = 30_000;

export class MCPServers {
  private servers = new Map<string, { status: "connected" | "disabled"; client?: MCPClient; tools: string[] }>();
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
        const client = new MCPClient(name, cfg);
        try {
          await withTimeout(client.connect(), CONNECT_TIMEOUT);
          const mcpTools = await withTimeout(client.listTools(), CONNECT_TIMEOUT);
          this.servers.set(name, { status: "connected", client, tools: mcpTools.map((t) => t.name) });
          for (const t of mcpTools) tools.push(this.adapt(name, client, t));
        } catch (e) {
          client.kill();
          this.servers.set(name, { status: "disabled", tools: [] });
          this.report(`MCP server "${name}" failed: ${(e as Error).message}`);
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
      async execute(args) {
        const result = await client.callTool(tool.name, args);
        const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
        return result.isError
          ? { content: `Error: ${text}`, isError: true }
          : { content: text || "(no output)" };
      },
      summarize(args) {
        return (args.url as string) ?? "";
      },
    };
  }

  list(): { name: string; status: "connected" | "disabled"; tools: string[] }[] {
    return [...this.servers.entries()].map(([name, s]) => ({ name, status: s.status, tools: s.tools }));
  }

  kill(): void {
    for (const { client } of this.servers.values()) client?.kill();
    this.servers.clear();
  }
}
