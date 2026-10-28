import { cfg } from "./config.js";
import { redactSecrets } from "./rpc.js";

const headers = { "x-key": cfg.appKey, "content-type": "application/json" };

export async function getSignals(since, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const workerUrl = deps.workerUrl ?? cfg.workerUrl;
  const extraSecrets = [workerUrl, cfg.appKey];

  let r;
  try {
    r = await fetchFn(`${workerUrl}/signals?since=${since}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    const rawMsg = e?.cause?.message ? `${e.message} (${e.cause.message})` : (e?.message || String(e));
    throw new Error(`signals network error: ${redactSecrets(rawMsg, extraSecrets)}`);
  }

  if (!r.ok) throw new Error(`signals HTTP ${r.status}`);

  try {
    return await r.json();
  } catch {
    throw new Error("signals malformed JSON");
  }
}

export const notify = (text) =>
  fetch(`${cfg.workerUrl}/notify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});

export const heartbeat = (open) =>
  fetch(`${cfg.workerUrl}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ open }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
