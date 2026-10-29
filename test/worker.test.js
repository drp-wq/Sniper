import test from "node:test";
import assert from "node:assert/strict";
import worker, { verifyInit, cleanRules, timingSafeEqualString } from "../worker/index.js";

// In-memory Mock KV implementing Cloudflare Worker KV interface
class MockKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type = "text") {
    const val = this.map.get(key);
    if (val === undefined) return null;
    if (type === "json") {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  }
  async put(key, value, options = {}) {
    this.map.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  async delete(key) {
    this.map.delete(key);
  }
}

let testQuerySeq = 0;
// Helper to create valid signed Telegram initData using HMAC-SHA256
async function createTelegramInitData(botToken, user, authDate = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", `AAG_test_${++testQuerySeq}`);
  params.set("user", typeof user === "string" ? user : JSON.stringify(user));

  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");

  const secretKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));

  const dataKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", dataKey, enc.encode(dcs));
  const hash = [...new Uint8Array(sigBytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

  params.set("hash", hash);
  return params.toString();
}

test("timingSafeEqualString: correctly matches identical strings and rejects mismatched/invalid inputs", async () => {
  assert.equal(await timingSafeEqualString("secret123", "secret123"), true);
  assert.equal(await timingSafeEqualString("secret123", "secret124"), false);
  assert.equal(await timingSafeEqualString("secret123", "short"), false);
  assert.equal(await timingSafeEqualString("", "secret"), false);
  assert.equal(await timingSafeEqualString(null, "secret"), false);
});

test("verifyInit: validates valid Telegram initData and rejects tampered, expired, and wrong-user cases", async () => {
  const env = {
    TG_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    TG_CHAT: "987654321",
  };

  const validUser = { id: 987654321, first_name: "Owner" };
  const validInit = await createTelegramInitData(env.TG_TOKEN, validUser);

  // 1. Valid initData
  assert.equal(await verifyInit(env, validInit), true);

  // 2. Tampered hash
  const tamperedInit = validInit.replace(/hash=[a-f0-9]{4}/, "hash=dead");
  assert.equal(await verifyInit(env, tamperedInit), false);

  // 3. Expired initData (> 24 hours)
  const expiredDate = Math.floor(Date.now() / 1000) - 90000;
  const expiredInit = await createTelegramInitData(env.TG_TOKEN, validUser, expiredDate);
  assert.equal(await verifyInit(env, expiredInit), false);

  // 4. Future authDate (> now + 300)
  const futureDate = Math.floor(Date.now() / 1000) + 10000;
  const futureInit = await createTelegramInitData(env.TG_TOKEN, validUser, futureDate);
  assert.equal(await verifyInit(env, futureInit), false);

  // 5. Wrong user ID
  const intruderUser = { id: 111222333, first_name: "Intruder" };
  const intruderInit = await createTelegramInitData(env.TG_TOKEN, intruderUser);
  assert.equal(await verifyInit(env, intruderInit), false);

  // 6. Missing initData or env credentials
  assert.equal(await verifyInit(env, ""), false);
  assert.equal(await verifyInit({}, validInit), false);
});

test("cleanRules: range-checks and sanitizes exit rules", () => {
  const input = {
    stopLoss: 20,         // valid [1, 95]
    bandDown: 60,         // invalid (> 50)
    bandUp: 15,           // valid [0, 100]
    timeStopSec: 5,       // invalid (< 10)
    maxHoldMin: 45,       // valid [1, 720]
    takeProfit: "150",    // parses to 150, valid [10, 1000]
    trailArm: 50,         // valid
    trail: 20,            // valid
    liqDrop: 30,          // valid
    invalidKey: 999,      // unknown key ignored
  };

  const cleaned = cleanRules(input);
  assert.equal(cleaned.stopLoss, 20);
  assert.equal(cleaned.bandUp, 15);
  assert.equal(cleaned.maxHoldMin, 45);
  assert.equal(cleaned.takeProfit, 150);
  assert.equal(cleaned.trailArm, 50);
  assert.equal(cleaned.trail, 20);
  assert.equal(cleaned.liqDrop, 30);
  assert.equal(cleaned.bandDown, undefined);
  assert.equal(cleaned.timeStopSec, undefined);
  assert.equal(cleaned.invalidKey, undefined);
});

test("worker /hook: deduplicates mints and caps queue at QMAX = 50", async () => {
  const kv = new MockKV();
  const env = {
    KV: kv,
    HELIUS_AUTH: "test-helius-secret",
    APP_KEY: "test-app-key",
  };

  // 1. Unauthorized webhook call
  const unauthReq = new Request("https://worker.dev/hook", {
    method: "POST",
    headers: { authorization: "wrong-secret" },
    body: JSON.stringify([{ signature: "tx1", tokenTransfers: [{ mint: "MintA" }] }]),
  });
  const unauthRes = await worker.fetch(unauthReq, env);
  assert.equal(unauthRes.status, 401);

  // 2. Ingest batch with duplicates and ignore list (WSOL)
  const WSOL = "So11111111111111111111111111111111111111112";
  const req1 = new Request("https://worker.dev/hook", {
    method: "POST",
    headers: { authorization: "test-helius-secret", "content-type": "application/json" },
    body: JSON.stringify([
      { signature: "tx1", tokenTransfers: [{ mint: "MintA" }, { mint: WSOL }, { mint: "MintA" }] },
      { signature: "tx2", tokenTransfers: [{ mint: "MintB" }] },
    ]),
  });
  const res1 = await worker.fetch(req1, env);
  assert.equal(res1.status, 200);

  const q1 = await kv.get("queue", "json");
  assert.equal(q1.items.length, 2);
  assert.equal(q1.items[0].mint, "MintA");
  assert.equal(q1.items[1].mint, "MintB");
  assert.equal(q1.seq, 2);

  // 3. Overflow test: push 60 mints, verify queue stays at 50
  const overflowTxs = [];
  for (let i = 1; i <= 60; i++) {
    overflowTxs.push({ signature: `tx_${i}`, tokenTransfers: [{ mint: `Mint_Overflow_${i}` }] });
  }
  const req2 = new Request("https://worker.dev/hook", {
    method: "POST",
    headers: { authorization: "test-helius-secret", "content-type": "application/json" },
    body: JSON.stringify(overflowTxs),
  });
  await worker.fetch(req2, env);

  const q2 = await kv.get("queue", "json");
  assert.equal(q2.items.length, 50);
  assert.equal(q2.seq, 62);
  assert.equal(q2.items[49].mint, "Mint_Overflow_60");
});

test("worker /signals & /halt: phone polling and kill switch", async () => {
  const kv = new MockKV();
  const env = {
    KV: kv,
    APP_KEY: "test-app-key",
  };

  // Seed 3 items in queue
  await kv.put("queue", JSON.stringify({
    seq: 3,
    items: [
      { id: 1, mint: "Mint1", ts: 1000 },
      { id: 2, mint: "Mint2", ts: 2000 },
      { id: 3, mint: "Mint3", ts: 3000 },
    ],
  }));

  // Poll with since = -1 (first poll learns seq only)
  const reqInitial = new Request("https://worker.dev/signals?since=-1", {
    headers: { "x-key": "test-app-key" },
  });
  const resInitial = await (await worker.fetch(reqInitial, env)).json();
  assert.equal(resInitial.seq, 3);
  assert.deepEqual(resInitial.signals, []);
  assert.equal(resInitial.halt, false);

  // Poll with since = 1 (gets items with id > 1)
  const reqPoll = new Request("https://worker.dev/signals?since=1", {
    headers: { "x-key": "test-app-key" },
  });
  const resPoll = await (await worker.fetch(reqPoll, env)).json();
  assert.equal(resPoll.signals.length, 2);
  assert.equal(resPoll.signals[0].mint, "Mint2");
  assert.equal(resPoll.signals[1].mint, "Mint3");

  // Activate kill switch via /halt?on=1
  const reqHalt = new Request("https://worker.dev/halt?on=1", {
    method: "POST",
    headers: { "x-key": "test-app-key" },
  });
  const resHalt = await (await worker.fetch(reqHalt, env)).json();
  assert.equal(resHalt.halt, true);

  // Poll again -> halt is true
  const resPollHalted = await (await worker.fetch(reqPoll, env)).json();
  assert.equal(resPollHalted.halt, true);

  // Resume via /halt?on=0
  const reqResume = new Request("https://worker.dev/halt?on=0", {
    method: "POST",
    headers: { "x-key": "test-app-key" },
  });
  const resResume = await (await worker.fetch(reqResume, env)).json();
  assert.equal(resResume.halt, false);
});

test("worker scheduled watchdog: sends alert on stale phone and clears on recovery", async () => {
  const kv = new MockKV();
  const telegramMessages = [];
  const env = {
    KV: kv,
    TG_TOKEN: "mock-token",
    TG_CHAT: "12345",
  };

  // Mock global fetch for telegram sendMessage
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("api.telegram.org")) {
      const body = JSON.parse(opts.body);
      telegramMessages.push(body);
      return new Response(JSON.stringify({ ok: true }));
    }
    return originalFetch(url, opts);
  };

  try {
    const now = Date.now();

    // 1. Recent heartbeat (< 12 min): no alert
    await kv.put("hb", JSON.stringify({ ts: now - 5 * 60 * 1000, open: [] }));
    await worker.scheduled({}, env);
    assert.equal(telegramMessages.length, 0);
    assert.equal(await kv.get("alerted"), null);

    // 2. Stale heartbeat (> 12 min): triggers Telegram alert and sets alerted in KV
    await kv.put("hb", JSON.stringify({ ts: now - 15 * 60 * 1000, open: [{ mint: "Mint1" }] }));
    await worker.scheduled({}, env);
    assert.equal(telegramMessages.length, 1);
    assert.ok(telegramMessages[0].text.includes("Phone silent for 15 min"));
    assert.ok(telegramMessages[0].text.includes("Open paper positions at last heartbeat: 1"));
    assert.equal(await kv.get("alerted"), "1");

    // 3. Next cron tick while still stale: does not duplicate alert
    await worker.scheduled({}, env);
    assert.equal(telegramMessages.length, 1);

    // 4. Phone recovers: heartbeat is fresh, alerted key is cleared
    await kv.put("hb", JSON.stringify({ ts: Date.now(), open: [] }));
    await worker.scheduled({}, env);
    assert.equal(await kv.get("alerted"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker /app and /api routes: serves UI, enforces RBAC, and records audit log", async () => {
  const kv = new MockKV();
  const env = {
    KV: kv,
    TG_TOKEN: "mock-token-123",
    TG_CHAT: "1001",
    TG_OPERATORS: "2001",
    TG_VIEWERS: "3001",
  };

  // 1. /app serves HTML panel
  const appRes = await worker.fetch(new Request("https://worker.dev/app"), env);
  assert.equal(appRes.status, 200);
  assert.equal(appRes.headers.get("content-type"), "text/html; charset=utf-8");

  // 2. Unauthenticated /api/state returns 401
  const unauthRes = await worker.fetch(new Request("https://worker.dev/api/state"), env);
  assert.equal(unauthRes.status, 401);

  // 3. Viewer access to /api/state
  const viewerInit = await createTelegramInitData(env.TG_TOKEN, { id: 3001, first_name: "Viewer" });
  const stateRes = await worker.fetch(new Request("https://worker.dev/api/state", {
    headers: { "x-init": viewerInit },
  }), env);
  assert.equal(stateRes.status, 200);
  const stateData = await stateRes.json();
  assert.equal(stateData.role, "viewer");
  assert.equal(stateData.halt, false);

  // 4. Viewer attempts to halt -> 403 (insufficient permissions)
  const viewerHalt = await worker.fetch(new Request("https://worker.dev/api/halt?on=1", {
    method: "POST",
    headers: { "x-init": viewerInit },
  }), env);
  assert.equal(viewerHalt.status, 403);

  // 5. Operator halts -> 200 OK
  const operatorInit = await createTelegramInitData(env.TG_TOKEN, { id: 2001, first_name: "Operator" });
  const opHalt = await worker.fetch(new Request("https://worker.dev/api/halt?on=1", {
    method: "POST",
    headers: { "x-init": operatorInit },
  }), env);
  assert.equal(opHalt.status, 200);
  const opHaltData = await opHalt.json();
  assert.equal(opHaltData.halt, true);

  // 6. Operator attempts to update rules -> 403 (admin only)
  const opRulesInit = await createTelegramInitData(env.TG_TOKEN, { id: 2001, first_name: "Operator" });
  const opRules = await worker.fetch(new Request("https://worker.dev/api/rules", {
    method: "POST",
    headers: { "x-init": opRulesInit, "content-type": "application/json" },
    body: JSON.stringify({ stopLoss: 20 }),
  }), env);
  assert.equal(opRules.status, 403);

  // 7. Admin updates rules -> 200 OK
  const adminInit = await createTelegramInitData(env.TG_TOKEN, { id: 1001, first_name: "Admin" });
  const adminRules = await worker.fetch(new Request("https://worker.dev/api/rules", {
    method: "POST",
    headers: { "x-init": adminInit, "content-type": "application/json" },
    body: JSON.stringify({ stopLoss: 20, maxHoldMin: 45 }),
  }), env);
  assert.equal(adminRules.status, 200);
  const adminRulesData = await adminRules.json();
  assert.equal(adminRulesData.rules.stopLoss, 20);
  assert.equal(adminRulesData.rules.maxHoldMin, 45);

  // 8. Audit log records events
  const audits = await kv.get("audit", "json");
  assert.ok(Array.isArray(audits));
  assert.ok(audits.some((a) => a.action === "halt" && a.role === "operator"));
});

test("worker watchdog & heartbeat: normalizes open positions, preserves telemetry, and never clears halt", async () => {
  const kv = new MockKV();
  const env = {
    KV: kv,
    TG_TOKEN: "mock-token",
    TG_CHAT: "12345",
    APP_KEY: "test-app-key",
  };

  // 1. Manually engage HALT
  await kv.put("halt", "1");
  await kv.put("queue", JSON.stringify({ seq: 10, items: [], halt: true }));

  // 2. Submit heartbeat with array open positions and telemetry
  const hbReq = new Request("https://worker.dev/heartbeat", {
    method: "POST",
    headers: { "x-key": "test-app-key", "content-type": "application/json" },
    body: JSON.stringify({
      open: [{ mint: "TokenA" }, { mint: "TokenB" }],
      dailyLoss: -12.5,
      halted: true,
      stats: { wins: 3 },
    }),
  });
  const hbRes = await worker.fetch(hbReq, env);
  assert.equal(hbRes.status, 200);

  const storedHb = await kv.get("hb", "json");
  assert.equal(storedHb.open, 2);
  assert.equal(storedHb.dailyLoss, -12.5);
  assert.equal(storedHb.halted, true);
  assert.equal(storedHb.stats.wins, 3);

  // 3. Trigger watchdog when phone is silent (stale timestamp)
  storedHb.ts = Date.now() - 20 * 60 * 1000;
  await kv.put("hb", JSON.stringify(storedHb));
  await worker.scheduled({}, env);

  // Assert halt remains engaged
  const haltAfterAlert = await kv.get("halt");
  assert.equal(haltAfterAlert, "1");
  const queueAfterAlert = await kv.get("queue", "json");
  assert.equal(queueAfterAlert.halt, true);

  // 4. Phone recovers (fresh heartbeat) -> watchdog clears alert, but HALT MUST REMAIN ENGAGED
  const recoverReq = new Request("https://worker.dev/heartbeat", {
    method: "POST",
    headers: { "x-key": "test-app-key", "content-type": "application/json" },
    body: JSON.stringify({ open: 1, dailyLoss: -12.5, halted: true }),
  });
  await worker.fetch(recoverReq, env);
  await worker.scheduled({}, env);

  assert.equal(await kv.get("alerted"), null); // alert cleared
  assert.equal(await kv.get("halt"), "1"); // HALT still engaged!
  const queueAfterRecover = await kv.get("queue", "json");
  assert.equal(queueAfterRecover.halt, true);
});

test("worker /api/proxy: enforces authentication, rejects SSRF and unapproved hosts, strips secrets", async () => {
  const kv = new MockKV();
  const env = {
    KV: kv,
    APP_KEY: "supersecret-app-key-12345",
    TG_TOKEN: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    TG_CHAT: "987654321",
  };

  const adminInit = await createTelegramInitData(env.TG_TOKEN, { id: 987654321, first_name: "Admin" });

  // 1. Unauthenticated request -> 401
  const unauthRes = await worker.fetch(new Request("https://worker.dev/api/proxy?url=https://api.dexscreener.com/test"), env);
  assert.equal(unauthRes.status, 401);

  // 2. Disallowed method (PUT) -> 405
  const putRes = await worker.fetch(new Request("https://worker.dev/api/proxy?url=https://api.dexscreener.com/test", {
    method: "PUT",
    headers: { "x-key": "supersecret-app-key-12345" },
  }), env);
  assert.equal(putRes.status, 405);

  // 3. Missing target -> 400
  const missingRes = await worker.fetch(new Request("https://worker.dev/api/proxy", {
    headers: { "x-key": "supersecret-app-key-12345" },
  }), env);
  assert.equal(missingRes.status, 400);

  // 4. SSRF against Cloud Metadata (169.254.169.254) -> 403
  const metadataRes = await worker.fetch(new Request("https://worker.dev/api/proxy?url=http://169.254.169.254/latest/meta-data", {
    headers: { "x-key": "supersecret-app-key-12345" },
  }), env);
  assert.equal(metadataRes.status, 403);

  // 5. SSRF against Loopback (127.0.0.1 / localhost) -> 403
  const loopbackRes = await worker.fetch(new Request("https://worker.dev/api/proxy?url=http://127.0.0.1:8080/admin", {
    headers: { "x-init": adminInit },
  }), env);
  assert.equal(loopbackRes.status, 403);

  // 6. Arbitrary attacker host -> 403
  const evilRes = await worker.fetch(new Request("https://worker.dev/api/proxy?url=https://attacker.com/steal-keys", {
    headers: { "x-key": "supersecret-app-key-12345" },
  }), env);
  assert.equal(evilRes.status, 403);

  // 7. Approved destination (DexScreener or Solana RPC) with mocked fetch
  const originalFetch = globalThis.fetch;
  let interceptedRequest = null;
  globalThis.fetch = async (input, init) => {
    interceptedRequest = { input, init };
    return new Response(JSON.stringify({ pairs: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const validRes = await worker.fetch(new Request("https://worker.dev/api/proxy?url=https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112", {
      headers: {
        "x-key": "supersecret-app-key-12345",
        "x-init": adminInit,
      },
    }), env);

    assert.equal(validRes.status, 200);
    assert.ok(interceptedRequest);
    // Crucial security check: internal secrets (x-key, x-init) MUST NOT be forwarded!
    assert.equal(interceptedRequest.init.headers["x-key"], undefined);
    assert.equal(interceptedRequest.init.headers["x-init"], undefined);
    assert.equal(interceptedRequest.init.redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
