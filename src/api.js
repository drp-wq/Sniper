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

export const getGmgnUrl = (mint) => `https://gmgn.ai/sol/token/${mint}`;
export const getDexScreenerUrl = (mint) => `https://dexscreener.com/solana/${mint}`;

export async function sendTelegram(text, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const tgToken = deps.tgToken ?? cfg.tgToken;
  const tgChat = deps.tgChat ?? cfg.tgChat;
  if (!tgToken || !tgChat) return false;

  try {
    const payload = {
      chat_id: tgChat,
      text: String(text).slice(0, 3500),
    };
    if (deps.parse_mode) payload.parse_mode = deps.parse_mode;
    if (deps.reply_markup) payload.reply_markup = deps.reply_markup;
    if (deps.disable_web_page_preview !== undefined) payload.disable_web_page_preview = deps.disable_web_page_preview;

    const res = await fetchFn(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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

  const bodyPayload = { text };
  if (deps.parse_mode) bodyPayload.parse_mode = deps.parse_mode;
  if (deps.reply_markup) bodyPayload.reply_markup = deps.reply_markup;
  if (deps.disable_web_page_preview !== undefined) bodyPayload.disable_web_page_preview = deps.disable_web_page_preview;

  if (workerUrl && appKey) {
    try {
      const r = await fetchFn(`${workerUrl}/notify`, {
        method: "POST",
        headers: { "x-key": appKey, "content-type": "application/json" },
        body: JSON.stringify(bodyPayload),
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
