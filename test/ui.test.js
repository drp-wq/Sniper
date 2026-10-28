import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createUiHandler } from "../src/ui.js";

function startEphemeralServer(handler) {
  return new Promise((resolve) => {
    const srv = createServer(handler);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => srv.close(r)),
      });
    });
  });
}

test("UI server serves mobile command center HTML, APK download, and secret-safe E2E proxy", async () => {
  const capturedCalls = [];
  const handler = createUiHandler({
    cfg: {
      workerUrl: "https://sniper-relay.example.workers.dev",
      appKey: "SUPER_SECRET_APP_KEY_777",
      rpcUrl: "https://mainnet.helius-rpc.com/?api-key=SUPER_SECRET_RPC_888",
    },
    fetch: async (url, init) => {
      capturedCalls.push({ url, init });
      if (url.includes("/export-kv")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            queue: { seq: 7, halt: false, items: [] },
            hb: { ts: 1700000000000, open: 1 },
          }),
        };
      }
      if (url.includes("helius-rpc.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ jsonrpc: "2.0", id: 1, result: 299999123 }),
        };
      }
      throw new Error(`network failure to ${url}`);
    },
  });

  const { baseUrl, close } = await startEphemeralServer(handler);
  try {
    // 1) Serve index.html with PAPER MODE ONLY and 5 tabs
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    const html = await indexRes.text();
    assert.ok(html.includes("PAPER MODE ONLY"));
    assert.ok(html.includes("Verify End-to-End Connection"));

    // 2) /api/status never exposes raw appKey or rpcUrl
    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    assert.equal(statusText.includes("SUPER_SECRET_APP_KEY_777"), false);
    assert.equal(statusText.includes("SUPER_SECRET_RPC_888"), false);
    const statusJson = JSON.parse(statusText);
    assert.equal(statusJson.paperOnly, true);
    assert.equal(statusJson.hasServerAppKey, true);
    assert.equal(statusJson.hasServerRpcUrl, true);

    // 3) /api/proxy injects x-key when calling configured workerUrl
    const proxyWorker = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://sniper-relay.example.workers.dev/export-kv",
        method: "GET",
      }),
    });
    const proxyWorkerJson = await proxyWorker.json();
    assert.equal(proxyWorkerJson.ok, true);
    assert.equal(proxyWorkerJson.data.queue.seq, 7);
    assert.equal(capturedCalls[0].init.headers["x-key"], "SUPER_SECRET_APP_KEY_777");

    // 4) /api/proxy maps __SERVER_ENV_RPC_URL__ to configured rpcUrl
    const proxyRpc = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "__SERVER_ENV_RPC_URL__",
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
      }),
    });
    const proxyRpcJson = await proxyRpc.json();
    assert.equal(proxyRpcJson.ok, true);
    assert.equal(proxyRpcJson.data.result, 299999123);

    // 4b) /api/proxy rejects non-POST RPC requests with 403
    const proxyRpcGet = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "__SERVER_ENV_RPC_URL__",
        method: "GET",
      }),
    });
    assert.equal(proxyRpcGet.status, 403);

    // 5) /api/proxy redacts secrets on upstream errors
    const proxyErr = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://sniper-relay.example.workers.dev/fail?api-key=SUPER_SECRET_RPC_888",
        method: "GET",
      }),
    });
    const proxyErrJson = await proxyErr.json();
    assert.equal(proxyErr.status, 502);
    assert.equal(proxyErrJson.error.includes("SUPER_SECRET_RPC_888"), false);

    // 5b) Security: /api/proxy rejects unapproved targets, prefix-spoofed domains, and IP literals
    const proxyBlockedExternal = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://failing.example.com/",
        method: "GET",
      }),
    });
    assert.equal(proxyBlockedExternal.status, 403);

    const proxyBlockedPrefix = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://sniper-relay.example.workers.dev.attacker.com/steal",
        method: "GET",
      }),
    });
    assert.equal(proxyBlockedPrefix.status, 403);

    const proxyBlockedIp = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://169.254.169.254/latest/meta-data/",
        method: "GET",
      }),
    });
    assert.equal(proxyBlockedIp.status, 403);

    const proxyBlockedCrossSite = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({
        url: "https://sniper-relay.example.workers.dev/export-kv",
        method: "GET",
      }),
    });
    assert.equal(proxyBlockedCrossSite.status, 403);

    // 6) /download/sniper-paper-bot.apk serves compiled APK binary
    const apkRes = await fetch(`${baseUrl}/download/sniper-paper-bot.apk`);
    assert.equal(apkRes.status, 200);
    assert.equal(apkRes.headers.get("content-type"), "application/vnd.android.package-archive");
    const apkBytes = new Uint8Array(await apkRes.arrayBuffer());
    assert.ok(apkBytes.length > 10000);
    // ZIP/APK magic header 'PK' (0x50, 0x4b)
    assert.equal(apkBytes[0], 0x50);
    assert.equal(apkBytes[1], 0x4b);

    // 7) F5 regressions: Origin check, Host header check, and https-only proxy targets
    // 7a) Origin http://localhost:9999 with mismatched Host -> 403
    const mismatchedOriginRes = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:9999",
      },
      body: JSON.stringify({
        url: "https://sniper-relay.example.workers.dev/export-kv",
        method: "GET",
      }),
    });
    assert.equal(mismatchedOriginRes.status, 403);

    // 7b) https origin -> 403
    const httpsOriginRes = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://127.0.0.1",
      },
      body: JSON.stringify({
        url: "https://sniper-relay.example.workers.dev/export-kv",
        method: "GET",
      }),
    });
    assert.equal(httpsOriginRes.status, 403);

    // Helper to send raw HTTP requests with custom forbidden headers like Host
    const sendRaw = (options, body = null) =>
      new Promise((resolve, reject) => {
        const req = request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
      });

    const parsedPort = Number(new URL(baseUrl).port);

    // 7c) Bad Host header on /api/status -> 403
    const badHostStatusRes = await sendRaw({
      hostname: "127.0.0.1",
      port: parsedPort,
      path: "/api/status",
      method: "GET",
      headers: { host: "evil.attacker.com" },
    });
    assert.equal(badHostStatusRes.status, 403);

    // 7d) Bad Host header on /api/proxy -> 403
    const badHostProxyRes = await sendRaw(
      {
        hostname: "127.0.0.1",
        port: parsedPort,
        path: "/api/proxy",
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "evil.attacker.com",
        },
      },
      JSON.stringify({
        url: "https://sniper-relay.example.workers.dev/export-kv",
        method: "GET",
      }),
    );
    assert.equal(badHostProxyRes.status, 403);

    // 7e) http:// worker target -> 403
    const httpWorkerTargetRes = await fetch(`${baseUrl}/api/proxy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "http://sniper-relay.example.workers.dev/export-kv",
        method: "GET",
      }),
    });
    assert.equal(httpWorkerTargetRes.status, 403);

    // 7f) Path traversal outside assetsDir -> 404
    const traversalRes = await fetch(`${baseUrl}/../package.json`);
    assert.equal(traversalRes.status, 404);
  } finally {
    await close();
  }
});
