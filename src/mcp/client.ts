import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig } from "../config.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPClient {
  private client = new Client({ name: "easy-agent", version: "1.0.0" }, { capabilities: {} });
  private transport: StdioClientTransport;

  constructor(private name: string, config: MCPServerConfig) {
    this.transport = new StdioClientTransport({ ...config, stderr: "ignore" });
  }

  connect(): Promise<void> {
    return this.client.connect(this.transport);
  }

  listTools(): Promise<Tool[]> {
    return this.client.listTools().then((r) => r.tools);
  }

  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  }

  kill(): void {
    const pid = this.transport.pid;
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
      }
    }
  }
}
