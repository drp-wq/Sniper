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
      return `${u.protocol}//${u.host}${u.pathname}${u.search ? "?[REDACTED]" : ""}`;
    } catch {
      return "[REDACTED_URL]";
    }
  });

  // Redact common query/header key patterns and Bearer tokens
  out = out.replace(/([?&](?:api[-_]?key|key|token|auth|secret)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/(\bbearer\s+)[^\s,"'<>]+/gi, "$1[REDACTED]");
  out = out.replace(/((?:api[-_]?key|x-key|authorization)\s*[:=]\s*)[^\s,"'<>]+/gi, "$1[REDACTED]");

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

export async function rpc(method, params, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const rpcUrl = deps.rpcUrl ?? cfg.rpcUrl;
  const extraSecrets = [rpcUrl, ...(deps.extraSecrets ?? [])];

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
    throw new Error(`${method}: network error: ${redactSecrets(rawMsg, extraSecrets)}`);
  }

  if (!r || typeof r.ok !== "boolean") {
    throw new Error(`${method}: invalid RPC response`);
  }

  if (!r.ok) {
    throw new Error(`${method}: HTTP ${r.status}`);
  }

  let j;
  try {
    j = await r.json();
  } catch {
    throw new Error(`${method}: malformed JSON response`);
  }

  if (!j || typeof j !== "object") {
    throw new Error(`${method}: invalid JSON-RPC payload`);
  }

  if (j.error) {
    const codePart = j.error.code !== undefined ? ` (code ${j.error.code})` : "";
    const safeMsg = redactSecrets(j.error.message ?? "RPC error", extraSecrets);
    throw new Error(`${method}${codePart}: ${safeMsg}`);
  }

  return j.result;
}
