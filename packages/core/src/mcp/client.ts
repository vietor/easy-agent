import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfig } from "./types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

const STDERR_MAX_LINES = 20;

export class MCPClient {
  private client: Client;
  private transport: Transport;
  private connectReject?: (e: Error) => void;
  private stderrBuf: string[] = [];

  constructor(
    private name: string,
    config: MCPServerConfig,
    clientInfo: { name: string; version: string },
  ) {
    this.client = new Client(clientInfo, { capabilities: {} });
    if ("command" in config) {
      const t = new StdioClientTransport({ ...config, stderr: "pipe" });
      this.transport = t;
      (t.stderr as Readable | null)?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf8").split(/\r?\n/)) {
          if (!line) continue;
          this.stderrBuf.push(line);
          if (this.stderrBuf.length > STDERR_MAX_LINES) this.stderrBuf.shift();
        }
      });
    } else {
      const opts = { requestInit: { headers: config.headers } };
      const url = new URL(config.url);
      this.transport = new StreamableHTTPClientTransport(url, opts);
    }
  }

  stderrTail(): string {
    return this.stderrBuf.join("\n");
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
    this.connectReject?.(new Error("aborted"));
    this.connectReject = undefined;
    this.client.close().catch(() => {});
    if (this.transport instanceof StdioClientTransport) {
      const pid = this.transport.pid;
      if (!pid) return;
      try {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        } else {
          process.kill(pid, "SIGTERM");
        }
      } catch {}
    }
  }
}
