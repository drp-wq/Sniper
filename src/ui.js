import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { redactSecrets } from "./rpc.js";
import { parseJsonlText } from "./report.js";

const ASSETS_DIR = resolve(dirnameFromUrl(import.meta.url), "../app/assets");

function dirnameFromUrl(url) {
  const p = fileURLToPath(url);
  return p.slice(0, p.lastIndexOf("/"));
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".apk": "application/vnd.android.package-archive",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readRequestBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejectBody(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

export function createUiHandler(deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const runtimeCfg = deps.cfg ?? cfg;
  const assetsDir = deps.assetsDir ?? ASSETS_DIR;

  return async function handleUiRequest(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;

    // Helper: validate target destination, route, and method against strict allowlist
    function validateProxyTarget(targetStr, method = "GET") {
      let u;
      try {
        u = new URL(targetStr);
      } catch {
        return null;
      }
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (u.username || u.password) return null;

      const hostname = u.hostname.toLowerCase();
      // Reject IP literals (IPv4, IPv6, octal, hex), cloud metadata, and loopback
      if (/^(?:\d+|0x[0-9a-f]+|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(hostname) ||
          hostname === "169.254.169.254" || hostname === "metadata.google.internal" || hostname === "localhost") {
        return null;
      }

      let parsedWorker = null;
      try {
        if (runtimeCfg.workerUrl) parsedWorker = new URL(runtimeCfg.workerUrl);
      } catch {}

      let parsedRpc = null;
      try {
        if (runtimeCfg.rpcUrl) parsedRpc = new URL(runtimeCfg.rpcUrl);
      } catch {}

      const isWorkerOrigin = parsedWorker && u.origin === parsedWorker.origin;
      const isRpcOrigin = parsedRpc && u.origin === parsedRpc.origin;
      const isDexOrigin = u.origin === "https://api.dexscreener.com";

      const isWorkerRead = isWorkerOrigin && (u.pathname === "/signals" || u.pathname === "/export-kv" || u.pathname === "/fail") && method === "GET";
      const isWorkerMutation = isWorkerOrigin && (u.pathname === "/heartbeat" || u.pathname === "/halt" || u.pathname === "/notify") && method === "POST";

      if (isWorkerRead || isWorkerMutation) {
        return { parsed: u, type: "worker" };
      }
      if (isRpcOrigin) {
        return { parsed: u, type: "rpc" };
      }
      if (isDexOrigin && u.pathname.startsWith("/latest/dex/tokens/") && method === "GET") {
        return { parsed: u, type: "dex" };
      }
      return null;
    }

    if (path === "/api/status" && req.method === "GET") {
      let openPositions = [];
      let archivedPositions = [];
      let events = [];

      if (existsSync("logs/positions.json")) {
        try {
          const parsed = JSON.parse(readFileSync("logs/positions.json", "utf8"));
          if (Array.isArray(parsed?.positions)) openPositions = parsed.positions;
          if (Array.isArray(parsed?.archivedUnresolved)) archivedPositions = parsed.archivedUnresolved;
        } catch {
          /* ignore */
        }
      }
      if (existsSync("logs/paper.jsonl")) {
        try {
          const { rows } = parseJsonlText(readFileSync("logs/paper.jsonl", "utf8"));
          events = rows.slice(-500);
        } catch {
          /* ignore */
        }
      }

      return sendJson(res, 200, {
        ok: true,
        paperOnly: true,
        workerUrl: runtimeCfg.workerUrl,
        hasServerAppKey: Boolean(runtimeCfg.appKey && runtimeCfg.appKey !== "test-app-key"),
        hasServerRpcUrl: Boolean(runtimeCfg.rpcUrl && !runtimeCfg.rpcUrl.includes("127.0.0.1")),
        openPositions,
        archivedPositions,
        events,
      });
    }

    if (path === "/api/proxy") {
      // Reject untrusted cross-origin requests
      const secFetchSite = req.headers["sec-fetch-site"];
      if (secFetchSite === "cross-site") {
        return sendJson(res, 403, { error: "cross-site requests forbidden" });
      }
      const origin = req.headers.origin;
      if (origin) {
        try {
          const o = new URL(origin);
          const isLocal = (o.hostname === "127.0.0.1" || o.hostname === "localhost");
          if (!isLocal) {
            return sendJson(res, 403, { error: "cross-origin requests forbidden" });
          }
        } catch {
          return sendJson(res, 403, { error: "invalid origin header" });
        }
      }

      try {
        const headerTargetUrl = req.headers["x-target-url"] ? String(req.headers["x-target-url"]).trim() : "";
        const rawBody = req.method !== "GET" && req.method !== "HEAD" ? await readRequestBody(req) : "";

        // Mode A: x-target-url header (used by integrated React Sniper-dashboard)
        if (headerTargetUrl) {
          let targetUrl = headerTargetUrl;
          if (targetUrl === "https://api.mainnet-beta.solana.com" || targetUrl === "__SERVER_ENV_RPC_URL__") {
            targetUrl = runtimeCfg.rpcUrl;
          }
          const method = req.method || "GET";
          const targetInfo = validateProxyTarget(targetUrl, method);
          if (!targetInfo) {
            return sendJson(res, 403, { error: "forbidden target destination or path" });
          }

          const headers = { "content-type": "application/json" };
          // Only forward APP_KEY to exact verified Worker origin
          if (targetInfo.type === "worker" && runtimeCfg.appKey) {
            headers["x-key"] = runtimeCfg.appKey;
          }

          const upstream = await fetchFn(targetUrl, {
            method,
            headers,
            body: req.method !== "GET" && req.method !== "HEAD" && rawBody ? rawBody : undefined,
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          const data = await upstream.json().catch(() => ({}));
          return sendJson(res, upstream.status || 200, data);
        }

        // Mode B: JSON envelope { url, method, headers, body }
        const parsed = JSON.parse(rawBody || "{}");
        let targetUrl = String(parsed.url || "").trim();
        const method = String(parsed.method || "GET").toUpperCase();
        const reqBody = parsed.body ?? null;

        if (targetUrl === "__SERVER_ENV_RPC_URL__" || targetUrl === "https://api.mainnet-beta.solana.com") {
          targetUrl = runtimeCfg.rpcUrl;
        }

        const targetInfo = validateProxyTarget(targetUrl, method);
        if (!targetInfo) {
          return sendJson(res, 403, { error: "forbidden target destination or path" });
        }

        const safeHeaders = { "content-type": "application/json" };
        // Forward APP_KEY only to verified Worker endpoints; do not forward caller x-key
        if (targetInfo.type === "worker" && runtimeCfg.appKey) {
          safeHeaders["x-key"] = runtimeCfg.appKey;
        }

        const started = Date.now();
        const upstream = await fetchFn(targetUrl, {
          method,
          headers: safeHeaders,
          body: method !== "GET" && method !== "HEAD" && reqBody ? reqBody : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        });
        const latencyMs = Date.now() - started;
        const data = await upstream.json().catch(() => null);
        return sendJson(res, 200, {
          ok: upstream.ok,
          status: upstream.status,
          data,
          latencyMs,
        });
      } catch (e) {
        return sendJson(res, 502, {
          ok: false,
          status: 502,
          error: redactSecrets(e?.message || String(e), [runtimeCfg.rpcUrl, runtimeCfg.appKey]),
        });
      }
    }

    if (path === "/download/sniper-paper-bot.apk" && req.method === "GET") {
      const apkPath = resolve(assetsDir, "../../sniper-paper-bot.apk");
      if (existsSync(apkPath)) {
        const buf = readFileSync(apkPath);
        res.writeHead(200, {
          "content-type": MIME_TYPES[".apk"],
          "content-disposition": 'attachment; filename="sniper-paper-bot.apk"',
          "content-length": buf.length,
        });
        res.end(buf);
        return;
      }
      return sendJson(res, 404, { error: "apk not built yet" });
    }

    // Serve static files from app/assets
    const cleanRel = path === "/" ? "/index.html" : path;
    const candidate = resolve(assetsDir, `.${cleanRel}`);
    if (!candidate.startsWith(assetsDir) || !existsSync(candidate)) {
      return sendJson(res, 404, { error: "not found" });
    }

    const ext = extname(candidate).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = readFileSync(candidate);
    res.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
    res.end(content);
  };
}

export function startUiServer(port = Number(process.env.UI_PORT || 8080), host = "127.0.0.1") {
  const server = createServer(createUiHandler());
  server.listen(port, host, () => {
    console.log(`Sniper Paper UI & E2E Proxy listening on http://${host}:${port}`);
  });
  return server;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  startUiServer();
}
