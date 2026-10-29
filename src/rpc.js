import { cfg } from "./config.js";

let id = 0;

<<<<<<< HEAD
export async function rpc(method, params) {
  const r = await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    signal: AbortSignal.timeout(8000),
=======
export function redactSecrets(input, extraSecrets = []) {
  let out = String(input ?? "");
  const secrets = [
    cfg?.rpcUrl,
    cfg?.workerUrl,
    cfg?.appKey,
    cfg?.tgToken,
    cfg?.tgChat,
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
>>>>>>> 48de9de (wip)
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
