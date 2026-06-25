import type { Tool } from "../tools/types.js";
import type { MCPServerConfig } from "../config.js";
import { MCPClient } from "./client.js";
import type { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";

const CONNECT_TIMEOUT = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([
    p.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timed,
  ]);
}

export class MCPServers {
  private servers = new Map<string, { client: MCPClient; tools: string[] }>();

  async connect(mcpServers: Record<string, MCPServerConfig> = {}): Promise<Tool[]> {
    const tools: Tool[] = [];
    await Promise.all(
      Object.entries(mcpServers).map(async ([name, cfg]) => {
        const client = new MCPClient(name, cfg);
        try {
          await withTimeout(client.connect(), CONNECT_TIMEOUT);
          const mcpTools = await withTimeout(client.listTools(), CONNECT_TIMEOUT);
          this.servers.set(name, { client, tools: mcpTools.map((t) => t.name) });
          for (const t of mcpTools) tools.push(this.adapt(name, client, t));
        } catch (e) {
          client.kill();
          console.error(`MCP server "${name}" failed: ${(e as Error).message}`);
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
        return result.isError ? `Error: ${text}` : text || "(no output)";
      },
      summarize(args) {
        return (args.url as string) ?? "";
      },
    };
  }

  list(): { name: string; tools: string[] }[] {
    return [...this.servers.entries()].map(([name, s]) => ({ name, tools: s.tools }));
  }

  kill(): void {
    for (const { client } of this.servers.values()) client.kill();
    this.servers.clear();
  }
}
