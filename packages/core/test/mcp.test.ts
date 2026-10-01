import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MCPClient } from "../src/mcp/client.js";
import { MCPServerManager } from "../src/mcp/manager.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { MCPServerConfig } from "../src/mcp/types.js";

const ECHO_SERVER = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } }) + "\\n");
  } else if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }] } }) + "\\n");
  } else if (msg.method === "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "boom" } }) + "\\n");
  }
});
`;

const INIT_ONLY_SERVER = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } }) + "\\n");
  }
});
`;

function echoServer(): MCPServerConfig {
  return { type: "stdio", command: "node", args: ["-e", ECHO_SERVER] };
}

test("killing the manager unregisters the MCP tools it registered", async () => {
  const tools = new ToolRegistry();
  const manager = new MCPServerManager(tools, { name: "test", version: "0" });
  await manager.connect({ fake: echoServer() });
  assert.ok(tools.schemas().some((s) => s.function.name === "MCP__fake__echo"), "the tool must be registered after connecting");
  manager.kill();
  assert.ok(!tools.schemas().some((s) => s.function.name === "MCP__fake__echo"), "the tool must be unregistered on kill");
});

test("killing the manager mid-connect does not throw", async () => {
  const tools = new ToolRegistry();
  const manager = new MCPServerManager(tools, { name: "test", version: "0" });
  const connecting = manager.connect({ slow: { type: "stdio", command: "node", args: ["-e", "setTimeout(() => {}, 5000)"] } });
  manager.kill();
  await connecting;
  assert.deepEqual(manager.list(), []);
});

test("a failing MCP tool call reports the tool and server in the error", async () => {
  const tools = new ToolRegistry();
  const manager = new MCPServerManager(tools, { name: "test", version: "0" });
  await manager.connect({ fake: echoServer() });
  const result = await tools.execute("MCP__fake__echo", {}, { cwd: process.cwd() });
  manager.kill();
  assert.equal(result.isError, true);
  assert.match(result.content, /MCP tool echo \(fake\) failed: .*boom/);
});

test("reconnecting a server replaces the old connection without duplicating tools", async () => {
  const tools = new ToolRegistry();
  const manager = new MCPServerManager(tools, { name: "test", version: "0" });
  await manager.connect({ fake: echoServer() });
  await manager.connect({ fake: echoServer() });
  const [info] = manager.list();
  assert.equal(info.status, "connected");
  assert.equal(tools.schemas().filter((s) => s.function.name === "MCP__fake__echo").length, 1);
  manager.kill();
});

test("a server that dies during connect reports its stderr tail", async () => {
  const tools = new ToolRegistry();
  const manager = new MCPServerManager(tools, { name: "test", version: "0" });
  const script = `process.stderr.write("fatal: config broken\\n"); setTimeout(() => process.exit(1), 200);`;
  await manager.connect({ broken: { type: "stdio", command: "node", args: ["-e", script] } });
  const [info] = manager.list();
  assert.equal(info.status, "failed");
  assert.match(info.error ?? "", /stderr: fatal: config broken/);
});

test("a tool call that outlives the client timeout fails", async () => {
  const client = new MCPClient(
    { type: "stdio", command: "node", args: ["-e", INIT_ONLY_SERVER] },
    { name: "test", version: "0" },
    100
  );
  await client.connect();
  try {
    await assert.rejects(() => client.callTool("echo", {}), /timed out/);
  } finally {
    client.kill();
  }
});

test("an HTTP server answering 404 marks the server failed", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const tools = new ToolRegistry();
    const manager = new MCPServerManager(tools, { name: "test", version: "0" });
    await manager.connect({ web: { type: "http", url: `http://127.0.0.1:${port}/mcp` } });
    const [info] = manager.list();
    assert.equal(info.status, "failed");
    assert.match(info.error ?? "", /Error POSTing/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
