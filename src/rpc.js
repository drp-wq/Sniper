import { cfg } from "./config.js";

let id = 0;

export function redactSecrets(input, extraSecrets = []) {
  let out = String(input ?? "");
  const secrets = [
    cfg?.rpcUrl,
    cfg?.workerUrl,
    cfg?.appKey,
    ...extraSecrets,
  ].filter((s) => typeof s === "string" && s.trim().length > 0);

  // Strip full URLs with query strings or credentials first
  out = out.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    try {
      const u = new URL(match);
      const portPart = u.port ? ":" + u.port : "";
      return `${u.protocol}//${u.hostname}${portPart}${u.pathname}${u.search ? "?[REDACTED]" : ""}`;
    } catch {
      return "[REDACTED_URL]";
    }
  });

  // Redact common query/header key patterns and Bearer tokens
  out = out.replace(/([?&](?:api[-_]?key|key|token|auth|secret|password)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/(\bbearer\s+)[^\s,"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/((?:api[-_]?key|x-key|authorization|password|token)\s*[:=]\s*)[^\s,"'<>]+/gi, "$1[REDACTED]");

  for (const s of secrets) {
    if (s.length >= 4) {
      out = out.split(s).join("[REDACTED]");
    }
    try {
      const u = new URL(s);
      for (const [, val] of u.searchParams.entries()) {
        if (val && val.length >= 4) {
          out = out.split(val).join("[REDACTED]");
        }
      }
    } catch {
      /* not a URL */
    }
  }

  return out.slice(0, 300);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_RPC_CODES = new Set([429, -32005, -32016]);

export async function rpc(method, params, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const rpcUrl = deps.rpcUrl ?? cfg.rpcUrl;
  const extraSecrets = [rpcUrl, ...(deps.extraSecrets ?? [])];
  const isTest =
    process.env.NODE_ENV === "test" ||
    process.env.NODE_TEST_CONTEXT !== undefined ||
    process.execArgv.some((arg) => arg.startsWith("--test"));
  const maxRetries = Math.max(
    0,
    Math.min(5, Math.floor(Number(deps.rpcRetries ?? cfg.rpcRetries ?? 2))),
  );
  const baseRetryMs = Math.max(
    1,
    Number(deps.rpcRetryMs ?? (isTest ? 5 : (cfg.rpcRetryMs ?? 500))),
  );
  const sleepFn = deps.sleep ?? defaultSleep;

  const maxAttempts = 1 + maxRetries;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let r;
    try {
      r = await fetchFn(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      const rawMsg = e?.cause?.message ? `${e.message} (${e.cause.message})` : (e?.message || String(e));
      lastErr = new Error(`${method}: network error: ${redactSecrets(rawMsg, extraSecrets)}`);
      lastErr.retryable = true;
      if (attempt < maxAttempts) {
        await sleepFn(baseRetryMs * attempt);
        continue;
      }
      throw lastErr;
    }

    if (!r || typeof r.ok !== "boolean") {
      const err = new Error(`${method}: invalid RPC response`);
      err.retryable = false;
      throw err;
    }

    if (!r.ok) {
      const status = Number(r.status);
      lastErr = new Error(`${method}: HTTP ${r.status}`);
      lastErr.retryable = RETRYABLE_HTTP_STATUS.has(status);
      if (lastErr.retryable && attempt < maxAttempts) {
        await sleepFn(baseRetryMs * attempt);
        continue;
      }
      throw lastErr;
    }

    let j;
    try {
      j = await r.json();
    } catch {
      const err = new Error(`${method}: malformed JSON response`);
      err.retryable = false;
      throw err;
    }

    if (!j || typeof j !== "object") {
      const err = new Error(`${method}: invalid JSON-RPC payload`);
      err.retryable = false;
      throw err;
    }

    if (j.error) {
      const code = Number(j.error.code);
      const codePart = j.error.code !== undefined ? ` (code ${j.error.code})` : "";
      const safeMsg = redactSecrets(j.error.message ?? "RPC error", extraSecrets);
      lastErr = new Error(`${method}${codePart}: ${safeMsg}`);
      lastErr.retryable = RETRYABLE_RPC_CODES.has(code) || /429|rate\s*limit|too\s*many/i.test(safeMsg);
      if (lastErr.retryable && attempt < maxAttempts) {
        await sleepFn(baseRetryMs * attempt);
        continue;
      }
      throw lastErr;
    }

    return j.result;
  }

  throw lastErr;
}
