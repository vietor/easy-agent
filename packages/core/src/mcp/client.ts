import { AbortedError } from "../util/async.js";
import { CALL_TIMEOUT_MS, STDERR_TAIL_BYTES } from "../util/constants.js";
import { killProcessTree } from "../util/subprocess.js";
import type { MCPClientInfo } from "./types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ResolvedMCPServerConfig } from "./types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export class MCPClient {
  private client: Client;
  private transport: Transport;
  private connectReject?: (e: Error) => void;
  private closing = false;
  private stderrBuffer = "";
  onClosed?: (error?: string) => void;

  get stderrTail(): string {
    return this.stderrBuffer;
  }

  constructor(
    config: ResolvedMCPServerConfig,
    clientInfo: MCPClientInfo,
    private callTimeoutMs: number = CALL_TIMEOUT_MS,
  ) {
    this.client = new Client(clientInfo, { capabilities: {} });
    if (config.type === "stdio") {
      const transport = new StdioClientTransport({ ...config, stderr: "pipe" });
      transport.stderr?.on("data", (chunk: Buffer) => {
        this.stderrBuffer = (this.stderrBuffer + chunk.toString()).slice(-STDERR_TAIL_BYTES);
      });
      this.transport = transport;
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
    return this.client.callTool({ name, arguments: args }, undefined, { signal, timeout: this.callTimeoutMs }) as Promise<CallToolResult>;
  }

  kill(): void {
    this.closing = true;
    this.connectReject?.(new AbortedError());
    this.connectReject = undefined;
    const pid = this.transport instanceof StdioClientTransport ? this.transport.pid : null;
    this.client.close().catch(() => {});
    killProcessTree(pid);
  }
}
