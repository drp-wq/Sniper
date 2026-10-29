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

// Editable from the Mini App. [min, max] per rule; anything else is rejected.
export const RULE_LIMITS = {
  stopLoss: [1, 95], bandDown: [0, 50], bandUp: [0, 100], timeStopSec: [10, 3600],
  maxHoldMin: [1, 720], takeProfit: [10, 1000], trailArm: [10, 1000], trail: [1, 90], liqDrop: [5, 95],
};

export function cleanRules(input) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RULE_LIMITS)) {
    const v = Number(input?.[k]);
    if (input && k in input && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
  }
  return out;
}

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

const replayCache = new Map();
const MAX_REPLAY_ENTRIES = 5000;

function pruneReplayCache(now) {
  if (replayCache.size > MAX_REPLAY_ENTRIES) {
    for (const [hash, exp] of replayCache.entries()) {
      if (exp <= now) replayCache.delete(hash);
    }
  }
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function authenticateTelegram(env, initData, { maxAgeSec = 86400, replayCheck = false } = {}) {
  if (!initData || typeof initData !== "string") {
    return { ok: false, error: "missing_init_data" };
  }
  if (!env?.TG_TOKEN) {
    return { ok: false, error: "unconfigured_server_credentials" };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, error: "missing_hash" };
  }
  params.delete("hash");

  const authDateStr = params.get("auth_date");
  if (!authDateStr) {
    return { ok: false, error: "missing_auth_date" };
  }
  const authDate = Number(authDateStr);
  const nowSec = Date.now() / 1000;
  if (!Number.isFinite(authDate)) {
    return { ok: false, error: "invalid_auth_date" };
  }
  if (authDate > nowSec + 300) {
    return { ok: false, error: "future_auth_date" };
  }
  if (nowSec - authDate > maxAgeSec) {
    return { ok: false, error: "stale_auth_date" };
  }

  const userStr = params.get("user");
  if (!userStr) {
    return { ok: false, error: "missing_user" };
  }
  let user;
  try {
    user = JSON.parse(userStr);
  } catch {
    return { ok: false, error: "malformed_user" };
  }
  if (!user || (typeof user.id !== "number" && typeof user.id !== "string") || !String(user.id).trim()) {
    return { ok: false, error: "invalid_user_id" };
  }

  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmacSha256(new TextEncoder().encode("WebAppData"), env.TG_TOKEN);
  const sig = [...(await hmacSha256(secret, dcs))].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (!(await timingSafeEqualString(sig, hash))) {
    return { ok: false, error: "invalid_signature" };
  }

  if (replayCheck) {
    const nowMs = Date.now();
    pruneReplayCache(nowMs);
    if (replayCache.has(hash)) {
      return { ok: false, error: "replay_detected" };
    }
    replayCache.set(hash, (authDate + maxAgeSec) * 1000);
  }

  return {
    ok: true,
    user: {
      id: String(user.id),
      firstName: String(user.first_name || ""),
      username: String(user.username || ""),
    },
    authDate,
  };
}

export function getRole(env, userId) {
  if (!userId || (typeof userId !== "string" && typeof userId !== "number")) return null;
  const targetId = String(userId).trim();
  if (!targetId) return null;

  if (env?.TG_CHAT && targetId === String(env.TG_CHAT).trim()) {
    return "admin";
  }

  if (env?.TG_OPERATORS) {
    const ops = String(env.TG_OPERATORS).split(",").map((s) => s.trim()).filter(Boolean);
    if (ops.includes(targetId)) return "operator";
  }

  if (env?.TG_VIEWERS) {
    const viewers = String(env.TG_VIEWERS).split(",").map((s) => s.trim()).filter(Boolean);
    if (viewers.includes(targetId)) return "viewer";
  }

  return null;
}

const ROLE_ACTIONS = {
  viewer: new Set(["read_state", "read_signals", "read_positions", "read_stats", "read_audit"]),
  operator: new Set(["read_state", "read_signals", "read_positions", "read_stats", "read_audit", "halt", "resume", "close_position", "close_all"]),
  admin: new Set(["read_state", "read_signals", "read_positions", "read_stats", "read_audit", "halt", "resume", "close_position", "close_all", "update_rules", "update_settings"]),
};

export function authorizeAction(role, action) {
  if (!role || !action || typeof role !== "string" || typeof action !== "string") return false;
  const allowed = ROLE_ACTIONS[role];
  return allowed ? allowed.has(action) : false;
}

const rateLimits = new Map();
const RATE_LIMIT_MAX_KEYS = 5000;

export function checkRateLimit(key, { limit = 60, windowMs = 60000 } = {}) {
  if (!key) return { allowed: true, remaining: limit, resetMs: 0 };
  const now = Date.now();
  if (rateLimits.size > RATE_LIMIT_MAX_KEYS) {
    for (const [k, v] of rateLimits.entries()) {
      if (now > v.resetAt) rateLimits.delete(k);
    }
  }

  let record = rateLimits.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 1, resetAt: now + windowMs };
    rateLimits.set(key, record);
    return { allowed: true, remaining: limit - 1, resetMs: windowMs };
  }

  record.count++;
  if (record.count > limit) {
    return { allowed: false, remaining: 0, resetMs: Math.max(0, record.resetAt - now) };
  }

  return { allowed: true, remaining: limit - record.count, resetMs: Math.max(0, record.resetAt - now) };
}

export function resetRateLimits() {
  rateLimits.clear();
}

export async function verifyInit(env, initData) {
  const res = await authenticateTelegram(env, initData);
  return res.ok && String(res.user?.id) === String(env?.TG_CHAT);
}

export async function recordAudit(env, entry) {
  if (!env?.KV || typeof env.KV.get !== "function" || typeof env.KV.put !== "function") return;
  try {
    const list = (await env.KV.get("audit", "json")) ?? [];
    const record = {
      id: (list[0]?.id ?? 0) + 1,
      ts: Date.now(),
      actorId: String(entry.actorId || "unknown"),
      role: String(entry.role || "unknown"),
      action: String(entry.action || "unknown"),
      target: String(entry.target || "system"),
      result: String(entry.result || "success"),
      detail: entry.detail ? JSON.parse(JSON.stringify(entry.detail)) : {},
    };
    list.unshift(record);
    await env.KV.put("audit", JSON.stringify(list.slice(0, 100)));
  } catch {
    /* never throw on audit logging */
  }
}

const APP_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>Sniper Panel</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:var(--tg-theme-bg-color,#0B0F17);--fg:var(--tg-theme-text-color,#fff);--hint:var(--tg-theme-hint-color,#888);--card:#161D2A;--btn:#2481cc;--btnfg:#fff}
*{box-sizing:border-box}body{margin:0;padding:12px;font:15px/1.4 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--fg)}
.card{background:var(--card);border-radius:12px;padding:12px;margin-bottom:10px}h2{font-size:12px;text-transform:uppercase;color:var(--hint);margin:0 0 8px}
.row{display:flex;justify-content:space-between;padding:4px 0}.good{color:#1a9f4b}.bad{color:#d93025}.hint{color:var(--hint)}
button{background:var(--btn);color:var(--btnfg);border:0;border-radius:8px;padding:10px;width:100%;margin-top:8px;font-size:14px;font-weight:600}
</style></head><body><div class="card" id="status"><h2>Control Plane (Paper-Only)</h2><div class="row"><span>Status</span><span class="good">Active</span></div></div></body></html>`;

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-key, x-init, x-target-url",
    },
  });

function redactWorkerError(err, env = {}) {
  let msg = String(err?.message || err || "storage_error");
  for (const secret of [env?.APP_KEY, env?.HELIUS_AUTH, env?.TG_TOKEN, env?.TG_CHAT]) {
    if (typeof secret === "string" && secret.length >= 4) {
      msg = msg.split(secret).join("[REDACTED]");
    }
  }
  return msg.slice(0, 200);
}

export async function tg(env, text, deps = {}) {
  let token = env?.TG_TOKEN;
  let chat = env?.TG_CHAT;

  if ((!token || !chat) && env?.KV) {
    try {
      if (!token) token = await env.KV.get("config:tg_token");
      if (!chat) chat = await env.KV.get("config:tg_chat");
    } catch {}
  }

  if (!token || !chat) return false;
  const fetchFn = deps.fetch ?? fetch;
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: String(text).slice(0, 3500),
      }),
    });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
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
        const open = Array.isArray(b?.open)
          ? b.open.length
          : (Number.isFinite(Number(b?.open)) ? Math.floor(Number(b.open)) : 0);
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
      const open = Array.isArray(b?.open)
        ? b.open.length
        : (Number.isFinite(Number(b?.open)) ? Math.floor(Number(b.open)) : 0);
      const now = Date.now();
      const prev = kvHbCache.get(env.KV);
      const hasTelegram = Boolean(env.TG_TOKEN && env.TG_CHAT);
      const payload = {
        ts: now,
        open,
        ...(b?.dailyLoss !== undefined ? { dailyLoss: Number(b.dailyLoss) || 0 } : {}),
        ...(b?.halted !== undefined ? { halted: Boolean(b.halted) } : {}),
        ...(b?.stats ? { stats: b.stats } : {}),
        ...(b?.gates ? { gates: b.gates } : {}),
        ...(b?.rules ? { rules: b.rules } : {}),
      };
      if (hasTelegram || !prev || prev.open !== open || now - prev.ts >= HB_MIN_WRITE_MS) {
        await env.KV.put("hb", JSON.stringify(payload));
        kvHbCache.set(env.KV, payload);
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

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, x-key, x-init, x-target-url",
        },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // Browser CORS proxy for Solana RPC & external endpoints
    if (path === "/api/proxy") {
      const targetUrl = req.headers.get("x-target-url") || url.searchParams.get("url");
      if (!targetUrl) return json({ error: "missing_target" }, 400);
      try {
        const body = (req.method === "POST" || req.method === "PUT") ? await req.text() : undefined;
        const targetRes = await fetch(targetUrl, {
          method: req.method,
          headers: {
            "content-type": "application/json",
            ...(req.headers.get("x-key") ? { "x-key": req.headers.get("x-key") } : {}),
          },
          body,
        });
        const targetBody = await targetRes.text();
        return new Response(targetBody, {
          status: targetRes.status,
          headers: {
            "content-type": targetRes.headers.get("content-type") || "application/json",
            "access-control-allow-origin": "*",
          },
        });
      } catch (e) {
        return json({ error: "proxy_failed", msg: String(e) }, 502);
      }
    }

    // Static Assets for Telegram Mini App / Web Terminal (if configured via wrangler [assets])
    if (env?.ASSETS) {
      if (
        path === "/" ||
        path === "/app" ||
        path === "/index.html" ||
        path.startsWith("/assets/") ||
        path.endsWith(".js") ||
        path.endsWith(".css") ||
        path.endsWith(".json") ||
        path.endsWith(".svg") ||
        path.endsWith(".html") ||
        path.endsWith(".png") ||
        path.endsWith(".ico")
      ) {
        const assetReq =
          path === "/" || path === "/app"
            ? new Request(new URL("/index.html", req.url), req)
            : req;
        const assetRes = await env.ASSETS.fetch(assetReq);
        if (assetRes && assetRes.status < 400) {
          return assetRes;
        }
      }
    }

    // Mini App page (fallback when ASSETS binding is unavailable).
    if ((path === "/app" || path === "/") && (req.method === "GET" || req.method === "HEAD")) {
      return new Response(APP_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // Mini App API routes: require Telegram initData authentication + RBAC or master APP_KEY
    if (path.startsWith("/api/")) {
      const clientIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "client";
      const rl = checkRateLimit(`api:${clientIp}`, { limit: 120, windowMs: 60000 });
      if (!rl.allowed) {
        return json({ error: "rate_limit_exceeded", resetMs: rl.resetMs }, 429);
      }

      const providedKey = req.headers.get("x-key")?.trim() || "";
      const expectedKey = env?.APP_KEY?.trim() || "";
      const hasAppKey = Boolean(
        providedKey.length >= 8 &&
        expectedKey.length >= 8 &&
        timingSafeEqualString(providedKey, expectedKey)
      );

      // Endpoint: Configure Telegram credentials without requiring initData if authenticated via APP_KEY
      if (path === "/api/telegram-config" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        let isAuthorized = hasAppKey;
        if (!isAuthorized && req.headers.get("x-init")) {
          const auth = await authenticateTelegram(env, req.headers.get("x-init")).catch(() => ({ ok: false }));
          if (auth.ok && getRole(env, auth.user?.id) === "admin") {
            isAuthorized = true;
          }
        }
        if (!isAuthorized) {
          return json({ error: "unauthorized" }, 401);
        }

        const tgToken = body?.tgToken ? String(body.tgToken).trim() : "";
        const tgChat = body?.tgChat ? String(body.tgChat).trim() : "";

        if (tgToken && env.KV) {
          await env.KV.put("config:tg_token", tgToken);
        }
        if (tgChat && env.KV) {
          await env.KV.put("config:tg_chat", tgChat);
        }

        const sent = await tg(
          env,
          "🎯 Solana Sniper Telegram Relay Activated!\nAlerts are now enabled for all footprints (signals, gates, paper trades, exits, and heartbeats)."
        );
        return json({ ok: true, sent: Boolean(sent) });
      }

      const auth = await authenticateTelegram(env, req.headers.get("x-init"), { replayCheck: req.method === "POST" });
      if (!auth.ok) {
        return json({ error: auth.error || "unauthorized" }, 401);
      }

      const role = getRole(env, auth.user.id);
      if (!role) {
        return json({ error: "forbidden" }, 403);
      }
      const user = auth.user;

      if (path === "/api/state" && req.method === "GET") {
        if (!authorizeAction(role, "read_state")) return json({ error: "insufficient_permissions" }, 403);
        const [q, hb, ctl] = await Promise.all([
          readKvQ(env),
          env.KV?.get ? env.KV.get("hb", "json") : null,
          env.KV?.get ? env.KV.get("ctl", "json") : null,
        ]);
        return json({
          ok: true,
          halt: Boolean(q.halt),
          seq: q.seq,
          rules: { ...(hb?.rules ?? {}), ...(ctl?.rules ?? {}) },
          hb: hb ?? {},
          role,
          user,
        });
      }

      if (path === "/api/halt" && req.method === "POST") {
        const haltOn = url.searchParams.get("on") === "1";
        const action = haltOn ? "halt" : "resume";
        if (!authorizeAction(role, action)) return json({ error: "insufficient_permissions" }, 403);

        await withKvMutex(env.KV, async () => {
          const q = await readKvQ(env);
          q.halt = haltOn;
          if (env.KV?.put) {
            await env.KV.put("halt", haltOn ? "1" : "0");
            await env.KV.put("queue", JSON.stringify(q));
          }
        });
        await recordAudit(env, {
          actorId: user.id,
          role,
          action,
          target: "engine",
          result: "success",
          detail: { halt: haltOn },
        });
        await tg(env, haltOn ? `HALT set by ${user.firstName || user.id}: no new entries` : `HALT cleared by ${user.firstName || user.id}`);
        return json({ ok: true, halt: haltOn });
      }

      if (path === "/api/rules" && req.method === "POST") {
        if (!authorizeAction(role, "update_rules")) return json({ error: "insufficient_permissions" }, 403);
        const body = await req.json().catch(() => ({}));
        const cleaned = cleanRules(body);
        let updatedRules = {};
        await withKvMutex(env.KV, async () => {
          const ctl = ((await env.KV.get("ctl", "json")) ?? { halt: false, rules: {} });
          ctl.rules = { ...(ctl.rules ?? {}), ...cleaned };
          updatedRules = ctl.rules;
          await env.KV.put("ctl", JSON.stringify(ctl));
        });
        await recordAudit(env, {
          actorId: user.id,
          role,
          action: "update_rules",
          target: "rules",
          result: "success",
          detail: cleaned,
        });
        await tg(env, `Rules updated by ${user.firstName || user.id}: ${JSON.stringify(cleaned)}`);
        return json({ ok: true, rules: updatedRules });
      }

      if (path === "/api/audit" && req.method === "GET") {
        if (!authorizeAction(role, "read_audit")) return json({ error: "insufficient_permissions" }, 403);
        const audits = (await env.KV?.get?.("audit", "json")) ?? [];
        return json({ ok: true, audit: audits });
      }

      return json({ error: "not found" }, 404);
    }

    // Helius webhook (its own auth header).
    if (path === "/hook" && req.method === "POST") {
      if (!env.HELIUS_AUTH || req.headers.get("authorization") !== env.HELIUS_AUTH) {
        return json({ error: "unauthorized" }, 401);
      }
      const stub = getQueueStub(env);
      if (stub) return stub.fetch(req);
      return handleWithKvFallback(req, env);
    }

    // Authenticate via APP_KEY (phone bot) or verified Telegram initData (Mini App client)
    const hasAppKey = Boolean(env.APP_KEY && req.headers.get("x-key") === env.APP_KEY);
    let isAuthedTg = false;
    if (!hasAppKey && req.headers.get("x-init")) {
      const auth = await authenticateTelegram(env, req.headers.get("x-init"));
      if (auth.ok) isAuthedTg = true;
    }

    if (!hasAppKey && !isAuthedTg) {
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
      const sent = await tg(env, b?.text ?? "");
      return json({ ok: true, sent: Boolean(sent) });
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

    // 1. Live Solana Token Discovery: automatically queue live tokens from DexScreener
    const isTest = typeof process !== "undefined" && (
      process.env?.NODE_ENV === "test" ||
      process.env?.NODE_TEST_CONTEXT !== undefined ||
      process.execArgv?.some((arg) => arg.startsWith("--test"))
    );

    if (!isTest) {
      try {
        const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
          headers: { "accept": "application/json" },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const tokens = await res.json();
          const solMints = (tokens || [])
            .filter((t) => t.chainId === "solana" && typeof t.tokenAddress === "string")
            .map((t) => t.tokenAddress);

          if (solMints.length > 0) {
            await withKvMutex(env.KV, async () => {
              const q = await readKvQ(env);
              let changed = false;
              const newMints = [];

              for (const mint of solMints.slice(0, 3)) {
                if (q.items.some((i) => i.mint === mint)) continue;
                q.seq += 1;
                q.items.push({
                  id: q.seq,
                  mint,
                  sig: `dex_${Date.now()}`,
                  ts: Date.now(),
                });
                newMints.push(mint);
                changed = true;
              }

              if (changed) {
                q.items = q.items.slice(-QMAX);
                await env.KV.put("queue", JSON.stringify(q));
                for (const m of newMints) {
                  await tg(
                    env,
                    `📡 LIVE DISCOVERY: ${m}\nDiscovered via DexScreener Scanner at ${new Date().toLocaleTimeString()}`
                  );
                }
              }
            });
          }
        }
      } catch {}
    }

    // 2. Watchdog / Phone Heartbeat monitor
    const hb = await env.KV.get("hb", "json").catch(() => null);
    if (!hb) return;
    const late = Date.now() - hb.ts > HB_LATE_MS;
    const alerted = await env.KV.get("alerted").catch(() => null);

    if (late && !alerted) {
      const mins = Math.round((Date.now() - hb.ts) / 60000);
      const openCount = Array.isArray(hb.open)
        ? hb.open.length
        : (Number.isFinite(Number(hb.open)) ? Math.floor(Number(hb.open)) : 0);
      await tg(
        env,
        `Phone silent for ${mins} min. Open paper positions at last heartbeat: ${openCount}`,
      );
      await env.KV.put("alerted", "1", { expirationTtl: 3600 }).catch(() => {});
    } else if (!late && alerted && typeof env.KV.delete === "function") {
      await env.KV.delete("alerted").catch(() => {});
    }
  },
};
