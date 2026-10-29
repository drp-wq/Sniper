// Cloudflare Worker relay with SQLite-backed Durable Object queue (SignalQueueDO).
// Helius webhook -> SignalQueueDO (transactional SQLite ring buffer) -> phone polls /signals.
// Also: Telegram alerts, heartbeat watchdog, kill switch, and one-time KV migration/fallback.
// Bindings: SIGNAL_QUEUE (Durable Object: SignalQueueDO), optional KV (legacy migration/fallback).
// Secrets: APP_KEY, HELIUS_AUTH, optional TG_TOKEN, TG_CHAT.
// Cron trigger: * * * * *

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const IGNORE = new Set([WSOL, USDC, USDT]);
const QMAX = 50;                    // keep the last 50 signals in the active ring buffer
const DEDUP_MAX = 1000;             // keep the last 1000 (sig, mint) pairs for delayed retry deduplication
const HB_LATE_MS = 12 * 60 * 1000;  // alert if the phone is silent this long
const HB_MIN_WRITE_MS = 5 * 60 * 1000; // throttle unchanged heartbeat writes
export const MAX_HOOK_BYTES = 256 * 1024; // 256 KB max payload for webhooks
export const MAX_BATCH_TXS = 100; // 100 tx batch limit to prevent DO overload

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function timingSafeEqualString(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) {
    return false;
  }
  const enc = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const a = new Uint8Array(hashA);
  const b = new Uint8Array(hashB);
  let diff = 0;
  for (let i = 0; i < 32; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0 && provided.length === expected.length;
}

function redactWorkerError(err, env = {}) {
  let msg = String(err?.message || err || "storage_error");
  for (const secret of [env?.APP_KEY, env?.HELIUS_AUTH, env?.TG_TOKEN, env?.TG_CHAT]) {
    if (typeof secret === "string" && secret.length >= 4) {
      msg = msg.split(secret).join("[REDACTED]");
    }
  }
  return msg.slice(0, 200);
}

export async function sendTelegram(env, chatId, text, extra = {}) {
  if (!env?.TG_TOKEN) return null;
  const recipient = chatId || env.TG_CHAT;
  if (!recipient) return null;
  const payload = {
    chat_id: recipient,
    text: String(text).slice(0, 4000),
    parse_mode: "Markdown",
    ...extra,
  };
  const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => null);
  return res ? res.json().catch(() => null) : null;
}

async function tg(env, text) {
  await sendTelegram(env, env?.TG_CHAT, text);
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

function parseOptionalTimestamp(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }
  return null;
}

function resolveSignalTimestamp(receivedAt, chainTs) {
  if (typeof chainTs !== "number" || !Number.isFinite(chainTs) || chainTs <= 0) return receivedAt;
  const chainTsMs = chainTs < 1e11 && receivedAt >= 1e12 ? Math.round(chainTs * 1000) : Math.round(chainTs);
  return chainTsMs > 0 && chainTsMs < receivedAt ? chainTsMs : receivedAt;
}

// Resolve remaining alert suppression deadline (ms) from legacy KV without inventing or extending TTL.
// Uses KV.list({ prefix: "alerted" }) for exact key-level expiration metadata when available,
// or explicit epoch timestamps encoded in the value. Never fabricates a fresh +3600s window from KV.get().
async function resolveKvAlertedUntilMs(kv, now = Date.now()) {
  if (!kv || typeof kv.get !== "function") return 0;
  const rawVal = await kv.get("alerted");
  if (rawVal === null || rawVal === undefined || rawVal === "" || rawVal === "0" || rawVal === false) {
    return 0;
  }

  const maxAllowedUntil = now + 3600 * 1000;

  if (typeof kv.list === "function") {
    const listed = await kv.list({ prefix: "alerted" });
    const keys = Array.isArray(listed?.keys) ? listed.keys : [];
    const entry = keys.find((k) => k && k.name === "alerted");
    if (!entry) {
      // Key expired between kv.get("alerted") and kv.list({ prefix: "alerted" })
      return 0;
    }
    const expSec = Number(entry.expiration);
    if (Number.isFinite(expSec) && expSec > 0) {
      const expiresAtMs = Math.floor(expSec * 1000);
      if (expiresAtMs <= now) return 0;
      return Math.min(expiresAtMs, maxAllowedUntil);
    }
    const metaExp = Number(entry?.metadata?.expiresAtMs ?? entry?.metadata?.expiration);
    if (Number.isFinite(metaExp) && metaExp > 1e9) {
      const expiresAtMs = metaExp < 1e11 ? Math.floor(metaExp * 1000) : Math.floor(metaExp);
      if (expiresAtMs <= now) return 0;
      return Math.min(expiresAtMs, maxAllowedUntil);
    }
  }

  // Fallback when kv.list is unavailable or key lacks list expiration metadata:
  // only honor an explicit epoch timestamp (> 1e9) encoded in rawVal; never invent +3600s from "1".
  const parsedNum = Number(rawVal);
  if (Number.isFinite(parsedNum) && parsedNum > 1e9) {
    const expiresAtMs = parsedNum < 1e11 ? Math.floor(parsedNum * 1000) : Math.floor(parsedNum);
    return expiresAtMs > now ? Math.min(expiresAtMs, maxAllowedUntil) : 0;
  }
  return 0;
}

// SQLite-backed Durable Object providing transactional sequence allocation,
// bounded signal retention (QMAX=50), durable webhook deduplication (DEDUP_MAX=1000),
// isolated halt state, and fail-closed one-time KV migration.
export class SignalQueueDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this._schemaReady = false;
    this._migrated = false;
    this._migrationPromise = null;
  }

  _ensureSchema() {
    if (this._schemaReady) return;
    const sql = this.ctx?.storage?.sql;
    if (!sql) {
      throw new Error("Durable Object SQLite storage (ctx.storage.sql) is required");
    }
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        val TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY,
        mint TEXT NOT NULL,
        sig TEXT NOT NULL,
        ts INTEGER NOT NULL,
        chain_ts INTEGER
      );
      CREATE TABLE IF NOT EXISTS seen_sigs (
        sig TEXT NOT NULL,
        mint TEXT NOT NULL,
        first_id INTEGER NOT NULL,
        first_ts INTEGER NOT NULL,
        chain_ts INTEGER,
        PRIMARY KEY (sig, mint)
      );
    `);
    this._schemaReady = true;
  }

  _getMeta(key, fallback = null) {
    const rows = [...this.ctx.storage.sql.exec("SELECT val FROM meta WHERE key = ? LIMIT 1", key)];
    return rows.length ? rows[0].val : fallback;
  }

  _setMeta(key, val) {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, val) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET val = excluded.val",
      key,
      String(val),
    );
  }

  _runTransaction(fn) {
    if (typeof this.ctx?.storage?.transactionSync === "function") {
      return this.ctx.storage.transactionSync(fn);
    }
    return fn();
  }

  async _migrateFromKvIfNeeded() {
    this._ensureSchema();
    if (this._migrated) return;
    if (this._getMeta("migrated_from_kv") === "1") {
      this._migrated = true;
      return;
    }
    if (this._migrationPromise) {
      return this._migrationPromise;
    }

    this._migrationPromise = (async () => {
      if (this._getMeta("migrated_from_kv") === "1") {
        this._migrated = true;
        return;
      }

      if (this.env?.KV && typeof this.env.KV.get === "function") {
        // Fail closed if any KV read throws: never swallow errors or mark migration complete on partial failure.
        const legacyQ = await this.env.KV.get("queue", "json");
        const legacyHb = await this.env.KV.get("hb", "json");
        const now = Date.now();
        const legacyAlertedUntilMs = await resolveKvAlertedUntilMs(this.env.KV, now);

        if (legacyQ !== null && legacyQ !== undefined && typeof legacyQ !== "object") {
          throw new Error("Invalid KV queue payload during migration");
        }

        this._runTransaction(() => {
          if (this._getMeta("migrated_from_kv") === "1") return;
          if (legacyQ && typeof legacyQ === "object") {
            const items = Array.isArray(legacyQ.items) ? legacyQ.items.slice(-QMAX) : [];
            let maxId = Number.isFinite(Number(legacyQ.seq)) ? Math.max(0, Math.floor(Number(legacyQ.seq))) : 0;
            for (const item of items) {
              const id = Number(item?.id);
              const mint = typeof item?.mint === "string" ? item.mint.trim() : "";
              const sig = typeof item?.sig === "string" ? item.sig.trim() : "";
              const rawTs = parseOptionalTimestamp(item?.ts) ?? Date.now();
              const chainTs = parseOptionalTimestamp(item?.chainTs);
              const ts = resolveSignalTimestamp(rawTs, chainTs);
              if (Number.isFinite(id) && id > 0 && mint) {
                if (id > maxId) maxId = id;
                this.ctx.storage.sql.exec(
                  "INSERT OR IGNORE INTO signals (id, mint, sig, ts, chain_ts) VALUES (?, ?, ?, ?, ?)",
                  id,
                  mint,
                  sig,
                  ts,
                  chainTs,
                );
                if (sig) {
                  this.ctx.storage.sql.exec(
                    "INSERT OR IGNORE INTO seen_sigs (sig, mint, first_id, first_ts, chain_ts) VALUES (?, ?, ?, ?, ?)",
                    sig,
                    mint,
                    id,
                    ts,
                    chainTs,
                  );
                }
              }
            }
            this._setMeta("seq", maxId);
            this._setMeta("halt", legacyQ.halt ? "1" : "0");
          }
          if (legacyHb && typeof legacyHb === "object" && Number.isFinite(Number(legacyHb.ts))) {
            this._setMeta("hb_ts", Math.floor(Number(legacyHb.ts)));
            this._setMeta("hb_open", Number.isFinite(Number(legacyHb.open)) ? Math.floor(Number(legacyHb.open)) : 0);
          }
          if (legacyAlertedUntilMs > now) {
            this._setMeta("alerted_until", legacyAlertedUntilMs);
          }
          this._setMeta("migrated_from_kv", "1");
        });
      } else {
        this._runTransaction(() => {
          if (this._getMeta("migrated_from_kv") === "1") return;
          this._setMeta("migrated_from_kv", "1");
        });
      }
      this._migrated = true;
    })();

    try {
      await this._migrationPromise;
    } catch (e) {
      this._migrationPromise = null;
      throw e;
    }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      await this._migrateFromKvIfNeeded();

      if (path === "/hook" && req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (body === null || typeof body !== "object") {
          return json({ error: "invalid_json" }, 400);
        }

        const txs = Array.isArray(body) ? body : [body];
        if (txs.length > MAX_BATCH_TXS) {
          return json({ error: "batch_limit_exceeded", max: MAX_BATCH_TXS, received: txs.length }, 400);
        }
        const result = this._runTransaction(() => {
          let seq = Number(this._getMeta("seq", "0")) || 0;
          let added = 0;

          for (const tx of txs) {
            if (!tx || typeof tx !== "object") continue;
            const receivedAt = Date.now();
            const sig = typeof tx.signature === "string" ? tx.signature.trim() : "";
            const chainTs = parseOptionalTimestamp(tx.timestamp);
            const signalTs = resolveSignalTimestamp(receivedAt, chainTs);

            for (const mint of extractMints(tx)) {
              if (sig) {
                const seenDup = [
                  ...this.ctx.storage.sql.exec(
                    "SELECT 1 FROM seen_sigs WHERE sig = ? AND mint = ? LIMIT 1",
                    sig,
                    mint,
                  ),
                ];
                if (seenDup.length > 0) continue;

                const activeDup = [
                  ...this.ctx.storage.sql.exec(
                    "SELECT 1 FROM signals WHERE sig = ? AND mint = ? LIMIT 1",
                    sig,
                    mint,
                  ),
                ];
                if (activeDup.length > 0) continue;
              }

              seq += 1;
              this.ctx.storage.sql.exec(
                "INSERT INTO signals (id, mint, sig, ts, chain_ts) VALUES (?, ?, ?, ?, ?)",
                seq,
                mint,
                sig,
                signalTs,
                chainTs,
              );
              if (sig) {
                this.ctx.storage.sql.exec(
                  "INSERT OR IGNORE INTO seen_sigs (sig, mint, first_id, first_ts, chain_ts) VALUES (?, ?, ?, ?, ?)",
                  sig,
                  mint,
                  seq,
                  signalTs,
                  chainTs,
                );
              }
              added += 1;
            }
          }

          if (added > 0) {
            this._setMeta("seq", seq);
            const queueCutoff = seq - QMAX;
            if (queueCutoff > 0) {
              this.ctx.storage.sql.exec("DELETE FROM signals WHERE id <= ?", queueCutoff);
            }
            const dedupCutoff = seq - DEDUP_MAX;
            if (dedupCutoff > 0) {
              this.ctx.storage.sql.exec("DELETE FROM seen_sigs WHERE first_id <= ?", dedupCutoff);
            }
          }

          return { ok: true, seq, added };
        });

        return json({ ok: result.ok });
      }

      if (path === "/export-kv" && req.method === "GET") {
        const snapshot = this._runTransaction(() => {
          const seq = Number(this._getMeta("seq", "0")) || 0;
          const halt = this._getMeta("halt", "0") === "1";
          const hbTs = Number(this._getMeta("hb_ts", "0")) || 0;
          const hbOpen = Number(this._getMeta("hb_open", "0")) || 0;
          const alertedUntil = Number(this._getMeta("alerted_until", "0")) || 0;
          const now = Date.now();
          const allRows = [
            ...this.ctx.storage.sql.exec(
              "SELECT id, mint, sig, ts, chain_ts FROM signals ORDER BY id ASC",
            ),
          ];
          const items = allRows.map((r) => ({
            id: Number(r.id),
            mint: r.mint,
            sig: r.sig,
            ts: Number(r.ts),
            ...(r.chain_ts !== null && r.chain_ts !== undefined
              ? { chainTs: Number(r.chain_ts) }
              : {}),
          }));
          const isAlerted = alertedUntil > now;
          const remainingSec = isAlerted ? Math.max(1, Math.ceil((alertedUntil - now) / 1000)) : 0;
          return {
            queue: { seq, halt, items },
            hb: hbTs > 0 ? { ts: hbTs, open: hbOpen } : null,
            alerted: isAlerted,
            alertedUntil: isAlerted ? alertedUntil : 0,
            alertedRemainingSec: remainingSec,
            alertedTtlSec: isAlerted ? Math.max(60, remainingSec) : 0,
          };
        });
        return json(snapshot);
      }

      if (path === "/signals" && req.method === "GET") {
        const rawSince = url.searchParams.get("since");
        const parsedSince = rawSince === null ? -1 : Number(rawSince);
        const since = Number.isFinite(parsedSince) ? parsedSince : -1;

        const payload = this._runTransaction(() => {
          const seq = Number(this._getMeta("seq", "0")) || 0;
          const halt = this._getMeta("halt", "0") === "1";
          const allRows = [
            ...this.ctx.storage.sql.exec(
              "SELECT id, mint, sig, ts, chain_ts FROM signals ORDER BY id ASC",
            ),
          ];
          const oldestId = allRows.length > 0 ? Number(allRows[0].id) : null;
          const signals =
            since < 0
              ? []
              : allRows
                  .filter((r) => Number(r.id) > since)
                  .map((r) => ({
                    id: Number(r.id),
                    mint: r.mint,
                    sig: r.sig,
                    ts: Number(r.ts),
                    ...(r.chain_ts !== null && r.chain_ts !== undefined
                      ? { chainTs: Number(r.chain_ts) }
                      : {}),
                  }));

          return { signals, seq, oldestId, halt };
        });

        return json(payload);
      }

      if (path === "/heartbeat" && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        const open = Number.isFinite(Number(b?.open)) ? Math.floor(Number(b.open)) : 0;
        const now = Date.now();

        this._runTransaction(() => {
          const prevTs = Number(this._getMeta("hb_ts", "0")) || 0;
          const prevOpen = Number(this._getMeta("hb_open", "-1"));
          const hasTelegram = Boolean(this.env?.TG_TOKEN && this.env?.TG_CHAT);
          if (!hasTelegram && open === prevOpen && now - prevTs < HB_MIN_WRITE_MS) {
            return;
          }
          this._setMeta("hb_ts", now);
          this._setMeta("hb_open", open);
        });

        return json({ ok: true });
      }

      if (path === "/halt" && req.method === "POST") {
        const haltOn = url.searchParams.get("on") === "1";
        this._runTransaction(() => {
          this._setMeta("halt", haltOn ? "1" : "0");
        });
        await tg(this.env, haltOn ? "HALT set: no new entries" : "HALT cleared");
        return json({ halt: haltOn });
      }

      if (path === "/scheduled" && req.method === "POST") {
        const check = this._runTransaction(() => {
          const hbTs = Number(this._getMeta("hb_ts", "0")) || 0;
          if (!hbTs) return { action: "none" };
          const open = Number(this._getMeta("hb_open", "0")) || 0;
          const now = Date.now();
          const late = now - hbTs > HB_LATE_MS;
          const alertedUntil = Number(this._getMeta("alerted_until", "0")) || 0;
          const alerted = alertedUntil > now;

          if (late && !alerted) {
            const mins = Math.round((now - hbTs) / 60000);
            this._setMeta("alerted_until", now + 3600 * 1000);
            return { action: "alert", mins, open };
          }
          if (!late && alertedUntil > 0) {
            this._setMeta("alerted_until", 0);
          }
          return { action: "none" };
        });

        if (check.action === "alert") {
          await tg(
            this.env,
            `Phone silent for ${check.mins} min. Open paper positions at last heartbeat: ${check.open}`,
          );
        }
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json(
        {
          ok: false,
          error: path === "/hook" ? "queue_persistence_failed" : "storage_unavailable",
          detail: redactWorkerError(err, this.env),
        },
        503,
      );
    }
  }
}

// Fallback serialized transactional adapter when env.SIGNAL_QUEUE is not bound
// (e.g., in legacy unit tests passing only env.KV). Preserves strict mutex serialization,
// isolated halt state, empty-queue oldestId=null, and explicit 503 persistence error handling.
const kvLocks = new WeakMap();
const kvHbCache = new WeakMap();

function withKvMutex(kvObj, fn) {
  const prev = kvLocks.get(kvObj) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  kvLocks.set(
    kvObj,
    next.catch(() => {}),
  );
  return next;
}

const readKvQ = async (env) => {
  const q = (await env.KV.get("queue", "json")) ?? {
    seq: 0,
    halt: false,
    items: [],
  };
  const separateHalt = await env.KV.get("halt");
  if (separateHalt === "1" || separateHalt === "0") {
    q.halt = separateHalt === "1";
  }
  return q;
};

async function handleWithKvFallback(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    if (path === "/hook" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body === null || typeof body !== "object") {
        return json({ error: "invalid_json" }, 400);
      }

      const txs = Array.isArray(body) ? body : [body];
      if (txs.length > MAX_BATCH_TXS) {
        return json({ error: "batch_limit_exceeded", max: MAX_BATCH_TXS, received: txs.length }, 400);
      }
      await withKvMutex(env.KV, async () => {
        const q = await readKvQ(env);
        const seenSigs = Array.isArray(q.seenSigs) ? q.seenSigs : [];
        let changed = false;

        for (const tx of txs) {
          if (!tx || typeof tx !== "object") continue;
          const receivedAt = Date.now();
          const sig = typeof tx.signature === "string" ? tx.signature.trim() : "";
          const chainTs = parseOptionalTimestamp(tx.timestamp);
          const signalTs = resolveSignalTimestamp(receivedAt, chainTs);

          for (const mint of extractMints(tx)) {
            const key = sig ? `${sig}:${mint}` : "";
            const duplicate =
              sig &&
              (q.items.some((i) => i.sig === sig && i.mint === mint) ||
                seenSigs.includes(key));
            if (duplicate) continue;

            q.seq += 1;
            q.items.push({
              id: q.seq,
              mint,
              sig,
              ts: signalTs,
              ...(chainTs !== null ? { chainTs } : {}),
            });
            if (key) {
              seenSigs.push(key);
            }
            changed = true;
          }
        }

        if (changed) {
          q.items = q.items.slice(-QMAX);
          q.seenSigs = seenSigs.slice(-DEDUP_MAX);
          await env.KV.put("queue", JSON.stringify(q));
        }
      });

      return json({ ok: true });
    }

    if (path === "/export-kv" && req.method === "GET") {
      const snapshot = await withKvMutex(env.KV, async () => {
        const q = await readKvQ(env);
        const hb = await env.KV.get("hb", "json");
        const now = Date.now();
        const alertedUntilMs = await resolveKvAlertedUntilMs(env.KV, now);
        const isAlerted = alertedUntilMs > now;
        const remainingSec = isAlerted ? Math.max(1, Math.ceil((alertedUntilMs - now) / 1000)) : 0;
        return {
          queue: { seq: q.seq, halt: Boolean(q.halt), items: q.items },
          hb: hb ?? null,
          alerted: isAlerted,
          alertedUntil: isAlerted ? alertedUntilMs : 0,
          alertedRemainingSec: remainingSec,
          alertedTtlSec: isAlerted ? Math.max(60, remainingSec) : 0,
        };
      });
      return json(snapshot);
    }

    if (path === "/signals" && req.method === "GET") {
      const rawSince = url.searchParams.get("since");
      const parsedSince = rawSince === null ? -1 : Number(rawSince);
      const since = Number.isFinite(parsedSince) ? parsedSince : -1;

      const payload = await withKvMutex(env.KV, async () => {
        const q = await readKvQ(env);
        const signals = since < 0 ? [] : q.items.filter((i) => i.id > since);
        const oldestId = q.items.length ? q.items[0].id : null;
        return {
          signals,
          seq: q.seq,
          oldestId,
          halt: Boolean(q.halt),
        };
      });

      return json(payload);
    }

    if (path === "/heartbeat" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const open = Number.isFinite(Number(b?.open)) ? Math.floor(Number(b.open)) : 0;
      const now = Date.now();
      const prev = kvHbCache.get(env.KV);
      const hasTelegram = Boolean(env.TG_TOKEN && env.TG_CHAT);
      if (hasTelegram || !prev || prev.open !== open || now - prev.ts >= HB_MIN_WRITE_MS) {
        await env.KV.put("hb", JSON.stringify({ ts: now, open }));
        kvHbCache.set(env.KV, { ts: now, open });
      }
      return json({ ok: true });
    }

    if (path === "/halt" && req.method === "POST") {
      const haltOn = url.searchParams.get("on") === "1";
      await withKvMutex(env.KV, async () => {
        const q = await readKvQ(env);
        q.halt = haltOn;
        await env.KV.put("halt", haltOn ? "1" : "0");
        await env.KV.put("queue", JSON.stringify(q));
      });
      await tg(env, haltOn ? "HALT set: no new entries" : "HALT cleared");
      return json({ halt: haltOn });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json(
      {
        ok: false,
        error: path === "/hook" ? "queue_persistence_failed" : "storage_unavailable",
        detail: redactWorkerError(err, env),
      },
      503,
    );
  }
}

function getQueueStub(env) {
  if (env?.SIGNAL_QUEUE && typeof env.SIGNAL_QUEUE.idFromName === "function") {
    const id = env.SIGNAL_QUEUE.idFromName("global");
    return env.SIGNAL_QUEUE.get(id);
  }
  return null;
}

export async function handleTelegramWebhook(req, env) {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (env?.TG_WEBHOOK_SECRET && secretHeader !== env.TG_WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update !== "object") {
    return json({ ok: true });
  }

  const origin = new URL(req.url).origin;
  const appBaseUrl = env?.MINI_APP_URL || `${origin}/`;
  const launchUrl = new URL(appBaseUrl);
  if (env?.APP_KEY) {
    launchUrl.searchParams.set("worker", origin);
    launchUrl.searchParams.set("key", env.APP_KEY);
  }

  // Handle Callback Queries (from inline buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const cbChatId = cb.message?.chat?.id;
    const cbData = cb.data;

    if (env?.TG_TOKEN && cb.id) {
      await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id }),
      }).catch(() => {});
    }

    if (cbData === "tma_status" && cbChatId) {
      await replyTelegramStatus(env, cbChatId, launchUrl.toString());
    } else if (cbData === "tma_halt" && cbChatId) {
      await toggleTelegramHalt(env, true);
      await sendTelegram(env, cbChatId, "🚨 *EMERGENCY HALT ACTIVATED*\nNew paper trade entries are paused.");
    } else if (cbData === "tma_resume" && cbChatId) {
      await toggleTelegramHalt(env, false);
      await sendTelegram(env, cbChatId, "✅ *EMERGENCY HALT CLEARED*\nPaper trade entries are active.");
    }
    return json({ ok: true });
  }

  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return json({ ok: true });

  const chatId = msg.chat?.id;
  if (!chatId) return json({ ok: true });

  const text = msg.text.trim();

  if (text.startsWith("/start") || text.startsWith("/app") || text.startsWith("/open")) {
    const welcome = [
      "🎯 *SOLANA SNIPER TERMINAL*",
      "• *Mode:* Paper / Shadow Trading Only",
      "• *Security:* Token-2022 Safety Gates + 2x Slip Stress",
      "• *Device:* Pixel 10 Pro XL / iPad (No Sideloading Required)",
      "",
      "Tap below to launch the full trading terminal directly inside Telegram:",
    ].join("\n");

    await sendTelegram(env, chatId, welcome, {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🚀 Launch Sniper Terminal",
              web_app: { url: launchUrl.toString() },
            },
          ],
          [
            { text: "📊 Check Status", callback_data: "tma_status" },
            { text: "🚨 Halt Entries", callback_data: "tma_halt" },
            { text: "▶️ Resume", callback_data: "tma_resume" },
          ],
        ],
      },
    });
    return json({ ok: true });
  }

  if (text.startsWith("/status")) {
    await replyTelegramStatus(env, chatId, launchUrl.toString());
    return json({ ok: true });
  }

  if (text.startsWith("/halt")) {
    await toggleTelegramHalt(env, true);
    await sendTelegram(env, chatId, "🚨 *EMERGENCY HALT ACTIVATED*\nNew paper trade entries are paused.");
    return json({ ok: true });
  }

  if (text.startsWith("/resume")) {
    await toggleTelegramHalt(env, false);
    await sendTelegram(env, chatId, "✅ *EMERGENCY HALT CLEARED*\nPaper trade entries are active.");
    return json({ ok: true });
  }

  if (text.startsWith("/help")) {
    const help = [
      "🤖 *SOLANA SNIPER COMMANDS*",
      "• `/app` - Launch Telegram Mini App",
      "• `/status` - Check live queue sequence and heartbeat",
      "• `/halt` - Emergency pause all paper trade entries",
      "• `/resume` - Resume paper trade entries",
    ].join("\n");
    await sendTelegram(env, chatId, help);
    return json({ ok: true });
  }

  return json({ ok: true });
}

async function replyTelegramStatus(env, chatId, appUrl) {
  const stub = getQueueStub(env);
  let state = null;
  if (stub) {
    const res = await stub.fetch(new Request("https://worker.internal/export-kv")).catch(() => null);
    state = res ? await res.json().catch(() => null) : null;
  } else if (env?.KV) {
    const q = await readKvQ(env);
    const hb = await env.KV.get("hb", "json").catch(() => null);
    state = { queue: q, hb };
  }
  const isHalted = Boolean(state?.queue?.halt);
  const seq = state?.queue?.seq ?? 0;
  const itemsCount = state?.queue?.items?.length ?? 0;
  const hb = state?.hb;
  const hbAgo = hb ? Math.max(0, Math.round((Date.now() - hb.ts) / 1000)) : null;

  const statusMsg = [
    "📊 *SNIPER RELAY STATUS*",
    `• *Queue State:* ${isHalted ? "🚨 HALTED" : "🟢 ACTIVE"}`,
    `• *Queue Sequence:* #${seq}`,
    `• *Signals In Buffer:* ${itemsCount}`,
    `• *Heartbeat:* ${hb ? `${hbAgo}s ago (${hb.open} open positions)` : "None recorded"}`,
    `• *Mode:* Paper Only (No Private Keys)`,
  ].join("\n");

  await sendTelegram(env, chatId, statusMsg, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🚀 Open Terminal",
            web_app: { url: appUrl },
          },
        ],
      ],
    },
  });
}

async function toggleTelegramHalt(env, haltOn) {
  const stub = getQueueStub(env);
  if (stub) {
    await stub.fetch(new Request(`https://worker.internal/halt?on=${haltOn ? 1 : 0}`, { method: "POST" })).catch(() => {});
  } else if (env?.KV) {
    await withKvMutex(env.KV, async () => {
      const q = await readKvQ(env);
      q.halt = haltOn ? 1 : 0;
      await env.KV.put("halt", haltOn ? "1" : "0");
      await env.KV.put("queue", JSON.stringify(q));
    });
  }
}

export async function handleTelegramSetup(req, env) {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!env?.TG_TOKEN) {
    return json({ error: "TG_TOKEN not configured in Worker secrets" }, 400);
  }

  const url = new URL(req.url);
  const origin = url.origin;
  const body = await req.json().catch(() => ({}));
  const miniAppUrl = body?.miniAppUrl || env?.MINI_APP_URL || `${origin}/`;
  const launchUrl = new URL(miniAppUrl);
  if (env?.APP_KEY) {
    launchUrl.searchParams.set("worker", origin);
    launchUrl.searchParams.set("key", env.APP_KEY);
  }

  // 1. Set Webhook
  const webhookUrl = `${origin}/telegram-webhook`;
  const setWebhookRes = await fetch(
    `https://api.telegram.org/bot${env.TG_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
  ).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  // 2. Set Commands
  const commands = [
    { command: "app", description: "🚀 Launch Solana Sniper Mini App" },
    { command: "status", description: "📊 Check queue sequence and heartbeat" },
    { command: "halt", description: "🚨 Emergency pause paper trading" },
    { command: "resume", description: "✅ Resume paper trading entries" },
    { command: "help", description: "ℹ️ Show command list" },
  ];
  const setCommandsRes = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/setMyCommands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  // 3. Set Chat Menu Button to open Mini App directly
  const setMenuButtonRes = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: "🚀 Launch Sniper",
        web_app: { url: launchUrl.toString() },
      },
    }),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

  // 4. Get Bot Info
  const meRes = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/getMe`)
    .then((r) => r.json()).catch(() => null);

  return json({
    ok: true,
    bot: meRes?.result || null,
    webhook: setWebhookRes,
    commands: setCommandsRes,
    menuButton: setMenuButtonRes,
    launchUrl: launchUrl.toString(),
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Telegram Bot Webhook (called directly by Telegram servers)
    if ((path === "/telegram-webhook" || path === "/tg-webhook") && req.method === "POST") {
      return handleTelegramWebhook(req, env);
    }

    // Static Assets for Telegram Mini App / Web Terminal (if configured via wrangler [assets])
    if (env?.ASSETS) {
      if (
        path === "/" ||
        path === "/app" ||
        path.startsWith("/assets/") ||
        path.endsWith(".js") ||
        path.endsWith(".css") ||
        path.endsWith(".json") ||
        path.endsWith(".svg") ||
        path.endsWith(".html")
      ) {
        return env.ASSETS.fetch(req);
      }
    }

    // Helius webhook (its own auth header).
    if (path === "/hook" && req.method === "POST") {
      const authHeader = req.headers.get("authorization");
      if (!env.HELIUS_AUTH || !(await timingSafeEqualString(authHeader, env.HELIUS_AUTH))) {
        return json({ error: "unauthorized" }, 401);
      }
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_HOOK_BYTES) {
        return json({ error: "payload_too_large" }, 413);
      }
      const rawText = await req.text();
      if (new TextEncoder().encode(rawText).length > MAX_HOOK_BYTES) {
        return json({ error: "payload_too_large" }, 413);
      }
      const forwardReq = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: rawText,
      });
      const stub = getQueueStub(env);
      if (stub) return stub.fetch(forwardReq);
      return handleWithKvFallback(forwardReq, env);
    }

    // Everything below requires the app key.
    const clientKey = req.headers.get("x-key");
    if (!env.APP_KEY || !(await timingSafeEqualString(clientKey, env.APP_KEY))) {
      return json({ error: "unauthorized" }, 401);
    }

    if (
      (path === "/signals" && req.method === "GET") ||
      (path === "/export-kv" && req.method === "GET") ||
      (path === "/heartbeat" && req.method === "POST") ||
      (path === "/halt" && req.method === "POST")
    ) {
      const stub = getQueueStub(env);
      if (stub) return stub.fetch(req);
      return handleWithKvFallback(req, env);
    }

    if (path === "/notify" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      await tg(env, b?.text ?? "");
      return json({ ok: true });
    }

    if (path === "/telegram-setup" && req.method === "POST") {
      return handleTelegramSetup(req, env);
    }

    return json({ error: "not found" }, 404);
  },

  // Dead-man's switch: runs every minute via cron.
  async scheduled(_event, env) {
    const stub = getQueueStub(env);
    if (stub) {
      await stub
        .fetch(new Request("https://worker.internal/scheduled", { method: "POST" }))
        .catch(() => {});
      return;
    }
    if (!env?.KV) return;
    const hb = await env.KV.get("hb", "json").catch(() => null);
    if (!hb) return;
    const late = Date.now() - hb.ts > HB_LATE_MS;
    const alerted = await env.KV.get("alerted").catch(() => null);

    if (late && !alerted) {
      const mins = Math.round((Date.now() - hb.ts) / 60000);
      await tg(
        env,
        `Phone silent for ${mins} min. Open paper positions at last heartbeat: ${hb.open}`,
      );
      await env.KV.put("alerted", "1", { expirationTtl: 3600 }).catch(() => {});
    } else if (!late && alerted && typeof env.KV.delete === "function") {
      await env.KV.delete("alerted").catch(() => {});
    }
  },
};
