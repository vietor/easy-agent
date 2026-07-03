import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig } from "../config.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { getPackageInfo } from "../util/package.js";

function getClientINfo() {
  const pkginfo = getPackageInfo();
  return { name: pkginfo.name, version: pkginfo.version };
}

export class MCPClient {
  private client = new Client(getClientINfo(), { capabilities: {} });
  private transport: StdioClientTransport;
  private connectReject?: (e: Error) => void;

  constructor(
    private name: string,
    config: MCPServerConfig,
  ) {
    this.transport = new StdioClientTransport({ ...config, stderr: "ignore" });
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

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  }

  kill(): void {
    this.connectReject?.(new Error("aborted"));
    this.connectReject = undefined;
    const pid = this.transport.pid;
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  }
}
