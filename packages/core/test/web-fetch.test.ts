import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { webFetchTool } from "../src/tools/web-fetch.js";

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (port: number) => Promise<void>
) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("retries transient status errors and succeeds", async () => {
  let hits = 0;
  await withServer((req, res) => {
    hits++;
    if (hits < 3) {
      res.writeHead(500);
      res.end("boom");
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    }
  }, async (port) => {
    const result = await webFetchTool.execute({ url: `http://127.0.0.1:${port}/x` }, { cwd: process.cwd() });
    assert.equal(result.content, '{"ok":true}');
    assert.equal(hits, 3);
  });
});

test("does not retry deterministic 4xx errors", async () => {
  let hits = 0;
  await withServer((req, res) => {
    hits++;
    res.writeHead(404);
    res.end("nope");
  }, async (port) => {
    await assert.rejects(
      webFetchTool.execute({ url: `http://127.0.0.1:${port}/x` }, { cwd: process.cwd() }),
      /404/
    );
    assert.equal(hits, 1);
  });
});
