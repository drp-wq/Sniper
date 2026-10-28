// Cloudflare Worker relay (paste into the dashboard editor).
// Helius webhook -> KV queue -> phone polls /signals. Also: Telegram alerts, heartbeat watchdog, kill switch.
// Bindings needed: KV (KV namespace). Secrets: APP_KEY, HELIUS_AUTH, TG_TOKEN, TG_CHAT.
// Cron trigger: * * * * *
// Note: Cloudflare KV is eventually consistent; concurrent webhook requests can experience read-modify-write races.

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const IGNORE = new Set([WSOL, USDC, USDT]);
const QMAX = 50;                    // keep the last 50 signals
const HB_LATE_MS = 12 * 60 * 1000;  // alert if the phone is silent this long

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json" },
  });

async function tg(env, text) {
  if (!env.TG_TOKEN || !env.TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TG_CHAT,
      text: String(text).slice(0, 3500),
    }),
  });
}

// Adapt this after verifying actual Helius webhook payloads.
export function extractMints(tx) {
  const out = new Set();
  for (const t of tx?.tokenTransfers ?? []) {
    if (typeof t?.mint === "string" && t.mint && !IGNORE.has(t.mint)) {
      out.add(t.mint);
    }
  }
  return [...out];
}

const readQ = async (env) =>
  (await env.KV.get("queue", "json")) ?? {
    seq: 0,
    halt: false,
    items: [],
  };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Helius webhook (its own auth header).
    if (path === "/hook" && req.method === "POST") {
      if (!env.HELIUS_AUTH || req.headers.get("authorization") !== env.HELIUS_AUTH) {
        return json({ error: "unauthorized" }, 401);
      }

      const body = await req.json().catch(() => null);
      if (body === null || typeof body !== "object") {
        return json({ error: "invalid_json" }, 400);
      }

      const txs = Array.isArray(body) ? body : [body];
      const q = await readQ(env);
      let changed = false;

      for (const tx of txs) {
        if (!tx || typeof tx !== "object") continue;
        const receivedAt = Date.now();
        const sig = typeof tx.signature === "string" ? tx.signature.trim() : "";
        const chainTs = Number.isFinite(Number(tx.timestamp)) ? Number(tx.timestamp) : null;

        for (const mint of extractMints(tx)) {
          // Deduplicate a transaction/mint pair, not all future events for a mint.
          // Missing signatures cannot be reliably deduplicated across retries.
          const duplicate =
            sig && q.items.some((i) => i.sig === sig && i.mint === mint);
          if (duplicate) continue;

          q.seq += 1;
          q.items.push({
            id: q.seq,
            mint,
            sig,
            ts: receivedAt,
            ...(chainTs !== null ? { chainTs } : {}),
          });
          changed = true;
        }
      }

      if (changed) {
        q.items = q.items.slice(-QMAX);
        await env.KV.put("queue", JSON.stringify(q));
      }

      return json({ ok: true });
    }

    // Everything below requires the app key.
    if (!env.APP_KEY || req.headers.get("x-key") !== env.APP_KEY) {
      return json({ error: "unauthorized" }, 401);
    }

    if (path === "/signals" && req.method === "GET") {
      const rawSince = url.searchParams.get("since");
      const parsedSince = rawSince === null ? -1 : Number(rawSince);
      const since = Number.isFinite(parsedSince) ? parsedSince : -1;
      const q = await readQ(env);

      // since=0 requests retained backlog; the phone filters stale entries.
      const signals =
        since < 0 ? [] : q.items.filter((i) => i.id > since);
      const oldestId = q.items.length ? q.items[0].id : q.seq + 1;

      return json({
        signals,
        seq: q.seq,
        oldestId,
        halt: q.halt,
      });
    }

    if (path === "/heartbeat" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const open = Number.isFinite(Number(b?.open)) ? Number(b.open) : 0;
      await env.KV.put(
        "hb",
        JSON.stringify({ ts: Date.now(), open }),
      );
      return json({ ok: true });
    }

    if (path === "/notify" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      await tg(env, b?.text ?? "");
      return json({ ok: true });
    }

    // Kill switch: POST /halt?on=1 to stop new entries, on=0 to resume.
    if (path === "/halt" && req.method === "POST") {
      const q = await readQ(env);
      q.halt = url.searchParams.get("on") === "1";
      await env.KV.put("queue", JSON.stringify(q));
      await tg(env, q.halt ? "HALT set: no new entries" : "HALT cleared");
      return json({ halt: q.halt });
    }

    return json({ error: "not found" }, 404);
  },

  // Dead-man's switch: runs every minute via cron.
  async scheduled(_event, env) {
    const hb = await env.KV.get("hb", "json");
    if (!hb) return;
    const late = Date.now() - hb.ts > HB_LATE_MS;
    const alerted = await env.KV.get("alerted");

    if (late && !alerted) {
      const mins = Math.round((Date.now() - hb.ts) / 60000);
      await tg(
        env,
        `Phone silent for ${mins} min. Open paper positions at last heartbeat: ${hb.open}`,
      );
      await env.KV.put("alerted", "1", { expirationTtl: 3600 });
    } else if (!late && alerted) {
      await env.KV.delete("alerted");
    }
  },
};
