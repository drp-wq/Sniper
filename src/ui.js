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
      try {
        const headerTargetUrl = req.headers["x-target-url"] ? String(req.headers["x-target-url"]).trim() : "";
        const rawBody = req.method !== "GET" && req.method !== "HEAD" ? await readRequestBody(req) : "";

        // Mode A: x-target-url header (used by integrated React Sniper-dashboard)
        if (headerTargetUrl) {
          let targetUrl = headerTargetUrl;
          if (targetUrl === "https://api.mainnet-beta.solana.com" || targetUrl === "__SERVER_ENV_RPC_URL__") {
            targetUrl = runtimeCfg.rpcUrl;
          }
          if (!/^https?:\/\//i.test(targetUrl)) {
            return sendJson(res, 400, { error: "invalid target url" });
          }

          const headers = { "content-type": "application/json" };
          const reqXKey = req.headers["x-key"] ? String(req.headers["x-key"]).trim() : "";
          const cleanWorker = (runtimeCfg.workerUrl || "").replace(/\/$/, "");
          if (reqXKey) {
            headers["x-key"] = reqXKey;
          } else if (cleanWorker && targetUrl.startsWith(cleanWorker) && runtimeCfg.appKey) {
            headers["x-key"] = runtimeCfg.appKey;
          }

          const upstream = await fetchFn(targetUrl, {
            method: req.method || "GET",
            headers,
            body: req.method !== "GET" && req.method !== "HEAD" && rawBody ? rawBody : undefined,
            signal: AbortSignal.timeout(10000),
          });
          const data = await upstream.json().catch(() => ({}));
          return sendJson(res, upstream.status || 200, data);
        }

        // Mode B: JSON envelope { url, method, headers, body }
        const parsed = JSON.parse(rawBody || "{}");
        let targetUrl = String(parsed.url || "").trim();
        const method = String(parsed.method || "GET").toUpperCase();
        const headers = { ...(parsed.headers && typeof parsed.headers === "object" ? parsed.headers : {}) };
        const reqBody = parsed.body ?? null;

        if (targetUrl === "__SERVER_ENV_RPC_URL__" || targetUrl === "https://api.mainnet-beta.solana.com") {
          targetUrl = runtimeCfg.rpcUrl;
        }

        if (!/^https?:\/\//i.test(targetUrl)) {
          return sendJson(res, 400, { error: "invalid target url" });
        }

        const cleanWorker = (runtimeCfg.workerUrl || "").replace(/\/$/, "");
        if (cleanWorker && targetUrl.startsWith(cleanWorker) && !headers["x-key"] && runtimeCfg.appKey) {
          headers["x-key"] = runtimeCfg.appKey;
        }

        const started = Date.now();
        const upstream = await fetchFn(targetUrl, {
          method,
          headers,
          body: method !== "GET" && method !== "HEAD" && reqBody ? reqBody : undefined,
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
