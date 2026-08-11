import { AbortedError } from "../util/async.js";
import { killProcessTree } from "../util/subprocess.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfig } from "./types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPClient {
  private client: Client;
  private transport: Transport;
  private connectReject?: (e: Error) => void;
  private closing = false;
  onClosed?: (error?: string) => void;

  constructor(
    config: MCPServerConfig,
    clientInfo: { name: string; version: string },
  ) {
    this.client = new Client(clientInfo, { capabilities: {} });
    if ("command" in config) {
      this.transport = new StdioClientTransport({ ...config, stderr: "ignore" });
    } else {
      const opts = { requestInit: { headers: config.headers } };
      const url = new URL(config.url);
      this.transport = new StreamableHTTPClientTransport(url, opts);
    }
    this.transport.onerror = (e) => { if (!this.closing) this.onClosed?.(e.message); };
    this.transport.onclose = () => { if (!this.closing) this.onClosed?.(); };
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectReject = reject;
      this.client
        .connect(this.transport)
        .then(resolve, reject)
        .finally(() => {
          this.connectReject = undefined;
        });
    });
  }

  async listTools(): Promise<Tool[]> {
    return this.client.listTools().then((r) => r.tools);
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    return this.client.callTool({ name, arguments: args }, undefined, { signal }) as Promise<CallToolResult>;
  }

  kill(): void {
    this.closing = true;
    this.connectReject?.(new AbortedError());
    this.connectReject = undefined;
    this.client.close().catch(() => {});
    if (this.transport instanceof StdioClientTransport) {
      killProcessTree(this.transport.pid);
    }
  }
}
