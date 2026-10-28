import { cfg } from "./config.js";

const headers = { "x-key": cfg.appKey, "content-type": "application/json" };

export async function getSignals(since) {
  const r = await fetch(`${cfg.workerUrl}/signals?since=${since}`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`signals HTTP ${r.status}`);
  return r.json();
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
