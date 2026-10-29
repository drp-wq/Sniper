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

export async function sendTelegram(text, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const tgToken = deps.tgToken ?? cfg.tgToken;
  const tgChat = deps.tgChat ?? cfg.tgChat;
  if (!tgToken || !tgChat) return false;

  try {
    const res = await fetchFn(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: tgChat,
        text: String(text).slice(0, 3500),
      }),
      signal: AbortSignal.timeout(8000),
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export const notify = async (text, deps = {}) => {
  const fetchFn = deps.fetch ?? fetch;
  const workerUrl = deps.workerUrl ?? cfg.workerUrl;
  const appKey = deps.appKey ?? cfg.appKey;
  let sentViaWorker = false;

  if (workerUrl && appKey) {
    try {
      const r = await fetchFn(`${workerUrl}/notify`, {
        method: "POST",
        headers: { "x-key": appKey, "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(8000),
      });
      if (r?.ok) {
        const body = await r.json().catch(() => ({}));
        sentViaWorker = body?.sent === true;
      }
    } catch {
      sentViaWorker = false;
    }
  }

  // Fallback to direct Telegram if worker didn't deliver or is unconfigured/offline
  if (!sentViaWorker && (deps.tgToken || cfg.tgToken) && (deps.tgChat || cfg.tgChat)) {
    return sendTelegram(text, deps).catch(() => false);
  }
  return sentViaWorker;
};

export const heartbeat = (snapshot) =>
  fetch(`${cfg.workerUrl}/heartbeat`, {
    method: "POST",
    headers,
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
