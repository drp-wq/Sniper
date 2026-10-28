import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { signalAgeMs, signalKey, sequenceGap } from "../src/signals.js";
import { loadConfig, parseNum } from "../src/config.js";
import { openPaper, openCount, isOpen, loadPositions, getConsumerState, _resetPaperStateForTests } from "../src/paper.js";
import { handle, pollOnce, shutdown, _resetMainStateForTests } from "../src/main.js";
import worker, { SignalQueueDO, timingSafeEqualString } from "../worker/index.js";

test("signal identity distinguishes transactions for the same mint", () => {
  assert.notEqual(
    signalKey({ id: 1, sig: "tx-a", mint: "mint-x" }),
    signalKey({ id: 2, sig: "tx-b", mint: "mint-x" }),
  );
});

test("signal identity deduplicates the same transaction and mint", () => {
  assert.equal(
    signalKey({ id: 1, sig: "tx-a", mint: "mint-x" }),
    signalKey({ id: 2, sig: "tx-a", mint: "mint-x" }),
  );
});

test("unsigned signals use queue identity instead of mint-only identity", () => {
  assert.notEqual(
    signalKey({ id: 1, mint: "mint-x" }),
    signalKey({ id: 2, mint: "mint-x" }),
  );
});

test("signal age is measurable and missing timestamps are explicit", () => {
  assert.equal(signalAgeMs({ ts: 1000 }, 2500), 1500);
  assert.equal(signalAgeMs({}, 2500), null);
});

test("queue gap counts IDs that could have fallen out of the bounded queue", () => {
  assert.equal(sequenceGap(10, 15), 4);
  assert.equal(sequenceGap(10, 11), 0);
  assert.equal(sequenceGap(-1, 15), 0);
  assert.equal(sequenceGap(0, 51), 0);
  assert.equal(sequenceGap(10, null), 0);
});

test("config numeric validation rejects NaN and out-of-range values", () => {
  assert.equal(parseNum({ MAX_OPEN: "7" }, "MAX_OPEN", 5, { min: 1, max: 100 }), 7);
  assert.throws(() => parseNum({ MAX_OPEN: "abc" }, "MAX_OPEN", 5, { min: 1, max: 100 }), /Invalid numeric env var/);
  assert.throws(() => parseNum({ ENTRY_SLIP: "-0.1" }, "ENTRY_SLIP", 0.05, { min: 0, max: 0.95 }), /Invalid numeric env var/);
  assert.throws(
    () => loadConfig({ RPC_URL: "", WORKER_URL: "https://w", APP_KEY: "k" }, { allowPlaceholder: false }),
    /Missing env var RPC_URL/,
  );
});

test("openPaper enforces MAX_OPEN atomically across concurrent entry attempts", async () => {
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const notifyFn = () => {};
  const slowQuote = async (mint) => {
    await new Promise((r) => setTimeout(r, 20));
    return { price: 1.0, liqUsd: 25000, pair: `pair-${mint}` };
  };

  // Launch 4 concurrent openPaper calls with maxOpen = 2 and duplicate mint-1
  await Promise.all([
    openPaper("mint-1", "sig-1a", { signalId: 1 }, { getQuote: slowQuote, log: logFn, notify: notifyFn, maxOpen: 2, minLiqUsd: 15000, entrySlip: 0.05, stateFile: null }),
    openPaper("mint-1", "sig-1b", { signalId: 2 }, { getQuote: slowQuote, log: logFn, notify: notifyFn, maxOpen: 2, minLiqUsd: 15000, entrySlip: 0.05, stateFile: null }),
    openPaper("mint-2", "sig-2", { signalId: 3 }, { getQuote: slowQuote, log: logFn, notify: notifyFn, maxOpen: 2, minLiqUsd: 15000, entrySlip: 0.05, stateFile: null }),
    openPaper("mint-3", "sig-3", { signalId: 4 }, { getQuote: slowQuote, log: logFn, notify: notifyFn, maxOpen: 2, minLiqUsd: 15000, entrySlip: 0.05, stateFile: null }),
  ]);

  assert.equal(openCount(), 2);
  assert.equal(isOpen("mint-1"), true);
  assert.equal(isOpen("mint-2"), true);
  assert.equal(isOpen("mint-3"), false);

  const opened = events.filter((e) => e.ev === "paper_open");
  assert.equal(opened.length, 2);
  const dupSkips = events.filter((e) => e.ev === "signal_skip" && e.reason === "position_already_open");
  assert.equal(dupSkips.length, 1);
  const maxOpenSkips = events.filter((e) => e.ev === "skip_maxopen");
  assert.equal(maxOpenSkips.length, 1);
  _resetPaperStateForTests();
});

test("pollOnce processes signals sequentially, logs queue gaps, skips stale signals, and preserves lagMs", async () => {
  _resetMainStateForTests(10);
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const order = [];

  await pollOnce({
    getSignals: async (since) => {
      assert.equal(since, 10);
      return {
        seq: 16,
        oldestId: 14,
        halt: false,
        signals: [
          { id: 14, mint: "mint-stale", sig: "sig-14", ts: 1000 },
          { id: 15, mint: "mint-fresh-1", sig: "sig-15", ts: 95000 },
          { id: 16, mint: "mint-fresh-2", sig: "sig-16", ts: 96000 },
        ],
      };
    },
    runGate: async (mint) => {
      order.push(`gate:${mint}`);
      await new Promise((r) => setTimeout(r, 10));
      return { pass: true, reasons: [], top10Pct: 12.5 };
    },
    openPaper: async (mint, sig, meta) => {
      order.push(`open:${mint}`);
      logFn("paper_open", { mint, sig, ...meta });
    },
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 100000,
  });

  // Verify gap of 3 signals (11, 12, 13) logged
  const gapEv = events.find((e) => e.ev === "signal_gap");
  assert.ok(gapEv);
  assert.equal(gapEv.missingSequenceCount, 3);

  // Verify stale signal skipped
  const staleEv = events.find((e) => e.ev === "signal_skip" && e.mint === "mint-stale");
  assert.ok(staleEv);
  assert.equal(staleEv.reason, "stale_signal");

  // Verify sequential execution order (gate 1 -> open 1 -> gate 2 -> open 2)
  assert.deepEqual(order, [
    "gate:mint-fresh-1",
    "open:mint-fresh-1",
    "gate:mint-fresh-2",
    "open:mint-fresh-2",
  ]);

  // Verify gate event includes lagMs for backward compatibility with report.js
  const gateEv = events.find((e) => e.ev === "gate" && e.mint === "mint-fresh-1");
  assert.ok(gateEv);
  assert.equal(gateEv.lagMs, 5000);
  assert.equal(gateEv.receivedAgeMs, 5000);
});

test("worker deduplicates by (sig, mint) while allowing new transactions for the same mint", async () => {
  const store = new Map();
  const env = {
    HELIUS_AUTH: "secret-helius",
    APP_KEY: "secret-app",
    KV: {
      get: async (k, type) => {
        const v = store.get(k);
        if (!v) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
      put: async (k, v) => {
        store.set(k, v);
      },
    },
  };

  const postHook = (body) =>
    worker.fetch(
      new Request("https://worker.local/hook", {
        method: "POST",
        headers: { authorization: "secret-helius", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );

  // First tx for mint-A
  let res = await postHook([{ signature: "sig-1", tokenTransfers: [{ mint: "mint-A" }] }]);
  assert.equal(res.status, 200);

  // Retry of same tx (sig-1, mint-A) -> deduplicated
  await postHook([{ signature: "sig-1", tokenTransfers: [{ mint: "mint-A" }] }]);

  // Second distinct tx (sig-2, mint-A) -> allowed!
  await postHook([{ signature: "sig-2", tokenTransfers: [{ mint: "mint-A" }] }]);

  const sigRes = await worker.fetch(
    new Request("https://worker.local/signals?since=0", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  assert.equal(sigRes.status, 200);
  const data = await sigRes.json();
  assert.equal(data.seq, 2);
  assert.equal(data.oldestId, 1);
  assert.equal(data.signals.length, 2);
  assert.equal(data.signals[0].sig, "sig-1");
  assert.equal(data.signals[1].sig, "sig-2");
});

test("shutdown handler is idempotent across SIGINT/SIGTERM/SIGHUP, persists state first, and does not exit in tests", () => {
  _resetMainStateForTests(0);
  const order = [];
  const events = [];

  const first = shutdown("SIGTERM", {
    savePositions: () => {
      order.push("savePositions");
      return true;
    },
    log: (ev, data) => {
      order.push(`log:${ev}`);
      events.push({ ev, ...data });
    },
    openCount: () => 3,
  });

  // Subsequent signals (SIGINT, SIGHUP) are no-ops
  const second = shutdown("SIGINT", {
    savePositions: () => {
      order.push("savePositions-duplicate");
      return true;
    },
    log: (ev) => order.push(`log-duplicate:${ev}`),
    openCount: () => 3,
  });
  const third = shutdown("SIGHUP", {
    savePositions: () => {
      order.push("savePositions-duplicate-2");
      return true;
    },
    log: (ev) => order.push(`log-duplicate-2:${ev}`),
    openCount: () => 3,
  });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(third, false);
  assert.deepEqual(order, ["savePositions", "log:stop"]);
  assert.equal(events.length, 1);
  assert.equal(events[0].signal, "SIGTERM");
  assert.equal(events[0].persisted, true);
  assert.equal(events[0].openPositions, 3);
  _resetMainStateForTests(0);
});

// Real SQLite-backed Durable Object storage adapter using Node v24 built-in node:sqlite (DatabaseSync)
function createRealSqliteStorage({ failOnInsert = false } = {}) {
  const db = new DatabaseSync(":memory:");
  let txDepth = 0;

  const sql = {
    exec(query, ...params) {
      const q = query.trim();
      if (params.length === 0 && q.includes(";") && /^CREATE\s+TABLE/i.test(q)) {
        db.exec(q);
        return [];
      }
      if (failOnInsert && /^INSERT\s+INTO\s+signals/i.test(q)) {
        throw new Error("SQLITE_FULL: database or disk is full");
      }
      const stmt = db.prepare(q);
      if (/^SELECT\b/i.test(q)) {
        return stmt.all(...params);
      }
      stmt.run(...params);
      return [];
    },
  };

  return {
    sql,
    transactionSync(fn) {
      const sp = `sp_${++txDepth}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const res = fn();
        db.exec(`RELEASE SAVEPOINT ${sp}`);
        return res;
      } catch (e) {
        db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
        db.exec(`RELEASE SAVEPOINT ${sp}`);
        throw e;
      } finally {
        txDepth -= 1;
      }
    },
  };
}

test("SignalQueueDO (real node:sqlite) allocates monotonic IDs across concurrent webhooks, isolates halt from hook races, migrates KV state, and returns 503 on persistence failure", async () => {
  // 1) Seed legacy KV state with 1 existing item (id=5), halt=true, and hb
  const kvStore = new Map([
    [
      "queue",
      JSON.stringify({
        seq: 5,
        halt: true,
        items: [{ id: 5, mint: "mint-legacy", sig: "sig-legacy", ts: 1000 }],
      }),
    ],
    ["hb", JSON.stringify({ ts: 2000, open: 2 })],
  ]);
  let kvQueueReads = 0;
  let failNextKvRead = true;

  const legacyKv = {
    get: async (k, type) => {
      if (k === "queue") {
        kvQueueReads += 1;
        if (failNextKvRead) {
          throw new Error("KV transient 503 read failure");
        }
      }
      const v = kvStore.get(k);
      if (!v) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k, v) => kvStore.set(k, v),
  };

  const storage = createRealSqliteStorage();
  let doInstance = null;
  const env = {
    HELIUS_AUTH: "secret-helius",
    APP_KEY: "secret-app",
    KV: legacyKv,
    SIGNAL_QUEUE: {
      idFromName: () => "global-id",
      get: () => {
        if (!doInstance) {
          doInstance = new SignalQueueDO({ storage }, env);
        }
        return doInstance;
      },
    },
  };

  // 1a) Transient KV read failure during initial migration MUST fail closed (503) and NOT mark migration complete
  const failedMigRes = await worker.fetch(
    new Request("https://worker.local/signals?since=0", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  assert.equal(failedMigRes.status, 503);

  // 1b) Allow KV read to succeed and fire 3 concurrent webhooks + /halt?on=0 + /signals concurrently
  failNextKvRead = false;
  const postHook = (sig, mint) =>
    worker.fetch(
      new Request("https://worker.local/hook", {
        method: "POST",
        headers: { authorization: "secret-helius", "content-type": "application/json" },
        body: JSON.stringify([{ signature: sig, tokenTransfers: [{ mint }] }]),
      }),
      env,
    );

  const [r1, r2, r3, rHalt] = await Promise.all([
    postHook("sig-6", "mint-6"),
    postHook("sig-7", "mint-7"),
    postHook("sig-8", "mint-8"),
    worker.fetch(
      new Request("https://worker.local/halt?on=0", {
        method: "POST",
        headers: { "x-key": "secret-app" },
      }),
      env,
    ),
  ]);

  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 200);
  assert.equal(rHalt.status, 200);
  // Single-flight migration: 1 failed attempt + 1 successful attempt = 2 KV reads total across all concurrent calls
  assert.equal(kvQueueReads, 2);

  const sigRes = await worker.fetch(
    new Request("https://worker.local/signals?since=0", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  const payload = await sigRes.json();
  assert.equal(payload.seq, 8);
  assert.equal(payload.oldestId, 5);
  assert.equal(payload.halt, false);
  assert.deepEqual(
    payload.signals.map((s) => s.id),
    [5, 6, 7, 8],
  );

  // 2) Verify lossless rollback snapshot via GET /export-kv (preserves queue, hb, and alert state)
  const exportRes = await worker.fetch(
    new Request("https://worker.local/export-kv", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  assert.equal(exportRes.status, 200);
  const exported = await exportRes.json();
  assert.equal(exported.queue.seq, 8);
  assert.equal(exported.queue.halt, false);
  assert.equal(exported.queue.items.length, 4);
  assert.deepEqual(exported.hb, { ts: 2000, open: 2 });

  // 3) Verify persistence failure returns HTTP 503 and never claims 200 ok
  const failStorage = createRealSqliteStorage({ failOnInsert: true });
  const failEnv = {
    HELIUS_AUTH: "secret-helius",
    APP_KEY: "secret-app",
    SIGNAL_QUEUE: {
      idFromName: () => "global-id",
      get: () => new SignalQueueDO({ storage: failStorage }, failEnv),
    },
  };
  const failRes = await worker.fetch(
    new Request("https://worker.local/hook", {
      method: "POST",
      headers: { authorization: "secret-helius", "content-type": "application/json" },
      body: JSON.stringify([{ signature: "sig-fail", tokenTransfers: [{ mint: "mint-fail" }] }]),
    }),
    failEnv,
  );
  assert.equal(failRes.status, 503);
  const failBody = await failRes.json();
  assert.equal(failBody.ok, false);
  assert.equal(failBody.error, "queue_persistence_failed");
});

test("SignalQueueDO deduplicates delayed webhook retries even after 50-signal queue eviction and preserves original chainTs age", async () => {
  const storage = createRealSqliteStorage();
  let doInstance = null;
  const env = {
    HELIUS_AUTH: "secret-helius",
    APP_KEY: "secret-app",
    SIGNAL_QUEUE: {
      idFromName: () => "global-id",
      get: () => {
        if (!doInstance) doInstance = new SignalQueueDO({ storage }, env);
        return doInstance;
      },
    },
  };

  const postTx = (sig, mint, timestampSec) =>
    worker.fetch(
      new Request("https://worker.local/hook", {
        method: "POST",
        headers: { authorization: "secret-helius", "content-type": "application/json" },
        body: JSON.stringify([
          {
            signature: sig,
            ...(timestampSec !== undefined ? { timestamp: timestampSec } : {}),
            tokenTransfers: [{ mint }],
          },
        ]),
      }),
      env,
    );

  // 1) Insert initial signal id=1 with old on-chain timestamp (1700000000 sec = 1700000000000 ms)
  await postTx("sig-evicted-1", "mint-evicted-1", 1700000000);

  // 2) Insert 55 more distinct signals (id=2..56) so id=1 is evicted from the 50-item signals ring buffer
  for (let i = 2; i <= 56; i++) {
    await postTx(`sig-${i}`, `mint-${i}`, 1700000000 + i);
  }

  let res = await worker.fetch(
    new Request("https://worker.local/signals?since=0", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  let data = await res.json();
  assert.equal(data.seq, 56);
  assert.equal(data.oldestId, 7);
  assert.equal(data.signals.length, 50);

  // 3) Delayed Helius retry of sig-evicted-1 arrives AFTER eviction from the 50-item queue:
  //    seen_sigs (DEDUP_MAX=1000) must suppress it and keep seq=56!
  await postTx("sig-evicted-1", "mint-evicted-1", 1700000000);

  res = await worker.fetch(
    new Request("https://worker.local/signals?since=0", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  data = await res.json();
  assert.equal(data.seq, 56);
  assert.equal(data.signals.some((s) => s.sig === "sig-evicted-1"), false);

  // 4) Verify original transaction timestamp is preserved and never refreshed to Date.now()
  assert.equal(data.signals[0].id, 7);
  assert.equal(data.signals[0].chainTs, 1700000007);
  assert.equal(data.signals[0].ts, 1700000007000);
  assert.ok(signalAgeMs(data.signals[0], 1700000107000) >= 100000);
});

test("pollOnce does not permanently consume a signal on retryable gate_error and retries on next poll", async () => {
  _resetMainStateForTests(0);
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const opened = [];
  let gateCalls = 0;

  const signalBatch = [
    { id: 1, mint: "mint-transient", sig: "sig-t1", ts: 95000 },
  ];

  // Poll 1: runGate fails transiently (e.g., RPC 429) -> must NOT mark signal seen or advance since past 0
  await pollOnce({
    getSignals: async (since) => {
      assert.equal(since, 0);
      return { seq: 1, oldestId: 1, halt: false, signals: signalBatch };
    },
    runGate: async () => {
      gateCalls += 1;
      throw new Error("getTokenLargestAccounts: HTTP 429");
    },
    openPaper: async (mint) => opened.push(mint),
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 100000,
  });

  assert.equal(gateCalls, 1);
  assert.equal(opened.length, 0);
  assert.equal(events.some((e) => e.ev === "gate_error"), true);

  // Poll 2: since is still 0, signal is retried and succeeds!
  await pollOnce({
    getSignals: async (since) => {
      assert.equal(since, 0);
      return { seq: 1, oldestId: 1, halt: false, signals: signalBatch };
    },
    runGate: async () => {
      gateCalls += 1;
      return { pass: true, reasons: [], top10Pct: 15 };
    },
    openPaper: async (mint) => opened.push(mint),
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 101000,
  });

  assert.equal(gateCalls, 2);
  assert.deepEqual(opened, ["mint-transient"]);

  // Poll 3: cursor has now advanced to 1 and signal is remembered as processed
  await pollOnce({
    getSignals: async (since) => {
      assert.equal(since, 1);
      return { seq: 1, oldestId: 1, halt: false, signals: [] };
    },
    runGate: async () => ({ pass: true, reasons: [], top10Pct: 15 }),
    openPaper: async (mint) => opened.push(mint),
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 102000,
  });
  _resetMainStateForTests(0);
  _resetPaperStateForTests();
});

test("startup poll with since=0, empty-queue oldestId=null, and persisted restart cursor work cleanly", async () => {
  _resetMainStateForTests(0);
  _resetPaperStateForTests();
  const dir = mkdtempSync(join(tmpdir(), "sniper-cursor-test-"));
  const stateFile = join(dir, "positions.json");
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });

  try {
    // 1) Cold-start poll with since=0 and oldestId=51 must NOT emit a false signal_gap
    await pollOnce({
      getSignals: async (since) => {
        assert.equal(since, 0);
        return {
          seq: 51,
          oldestId: 51,
          halt: false,
          signals: [{ id: 51, mint: "mint-51", sig: "sig-51", ts: 95000 }],
        };
      },
      runGate: async () => ({ pass: false, reasons: ["mint authority not revoked"], top10Pct: null }),
      isOpen: () => false,
      isHalted: () => false,
      log: logFn,
      stateFile,
      maxSignalAgeMs: 60000,
      now: () => 100000,
    });
    assert.equal(events.some((e) => e.ev === "signal_gap"), false);

    // 2) Simulate restart: loadPositions restores consumer cursor (since=51) and seenKeys
    _resetMainStateForTests(0);
    _resetPaperStateForTests();
    loadPositions(stateFile, { log: logFn, maxOpen: 5 });

    await pollOnce({
      getSignals: async (since) => {
        assert.equal(since, 51);
        return { seq: 51, oldestId: null, halt: false, signals: [] };
      },
      runGate: async () => ({ pass: true, reasons: [], top10Pct: 10 }),
      isOpen: () => false,
      isHalted: () => false,
      log: logFn,
      stateFile,
      maxSignalAgeMs: 60000,
      now: () => 101000,
    });
    assert.equal(events.some((e) => e.ev === "signal_gap"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetMainStateForTests(0);
    _resetPaperStateForTests();
  }
});

test("pollOnce handles out-of-order signals, invalid-ID retryable failures, and rolls back cursor on disk save failure", async () => {
  _resetMainStateForTests(10);
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });

  // 1) Out-of-order signals [id=12, id=11] where id=11 fails retryably and id=12 succeeds:
  //    Cursor must stay at 10 (minFailedId - 1) while id=12 is remembered as processed
  await pollOnce({
    getSignals: async (since) => {
      assert.equal(since, 10);
      return {
        seq: 12,
        oldestId: 11,
        halt: false,
        signals: [
          { id: 12, mint: "mint-12-ok", sig: "sig-12", ts: 95000 },
          { id: 11, mint: "mint-11-fail", sig: "sig-11", ts: 95000 },
        ],
      };
    },
    runGate: async (mint) => {
      if (mint === "mint-11-fail") throw new Error("RPC 429");
      return { pass: false, reasons: ["mint authority not revoked"], top10Pct: null };
    },
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 100000,
  });

  assert.equal(getConsumerState().since, 10);

  // 2) Retryable failure on a signal with missing/invalid id (id: null) must NOT advance cursor to seq
  await pollOnce({
    getSignals: async (since) => {
      assert.equal(since, 10);
      return {
        seq: 15,
        oldestId: 11,
        halt: false,
        signals: [{ id: null, mint: "mint-no-id", sig: "sig-no-id", ts: 95000 }],
      };
    },
    runGate: async () => {
      throw new Error("RPC 503");
    },
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 100000,
  });

  assert.equal(getConsumerState().since, 10);

  // 3) Disk persistence failure at the end of pollOnce must roll back in-memory since and seenKeys
  await pollOnce({
    stateFile: "/tmp/nonexistent-dir/positions.json",
    savePositions: () => false,
    getSignals: async (since) => {
      assert.equal(since, 10);
      return {
        seq: 11,
        oldestId: 11,
        halt: false,
        signals: [{ id: 11, mint: "mint-11-ok", sig: "sig-11", ts: 95000 }],
      };
    },
    runGate: async () => ({ pass: false, reasons: ["freeze authority not revoked"], top10Pct: null }),
    isOpen: () => false,
    isHalted: () => false,
    log: logFn,
    maxSignalAgeMs: 60000,
    now: () => 100000,
  });

  assert.equal(getConsumerState().since, 10);
  assert.equal(getConsumerState().seenKeys.includes("sig-11:mint-11-ok"), false);

  _resetMainStateForTests(0);
  _resetPaperStateForTests();
});

test("webhook and signalAgeMs handle null, empty, whitespace, boolean, array, object, non-positive, malformed, seconds, and ms timestamps consistently", async () => {
  const nowMs = Date.now();
  const validSec = Math.floor((nowMs - 20_000) / 1000);
  const validMs = nowMs - 15_000;

  // 1) Direct unit checks on signalAgeMs
  assert.equal(signalAgeMs({ ts: null }, nowMs), null);
  assert.equal(signalAgeMs({ ts: "" }, nowMs), null);
  assert.equal(signalAgeMs({ ts: "   " }, nowMs), null);
  assert.equal(signalAgeMs({ ts: false }, nowMs), null);
  assert.equal(signalAgeMs({ ts: true }, nowMs), null);
  assert.equal(signalAgeMs({ ts: [] }, nowMs), null);
  assert.equal(signalAgeMs({ ts: {} }, nowMs), null);
  assert.equal(signalAgeMs({ ts: 0 }, nowMs), null);
  assert.equal(signalAgeMs({ ts: -500 }, nowMs), null);
  assert.equal(signalAgeMs({ ts: "not-a-timestamp" }, nowMs), null);

  // Invalid chainTs values must be ignored (falling back to receivedAt = nowMs - 5000)
  for (const badChainTs of [null, undefined, "", "   ", false, true, [], {}, 0, -10, "NaN", "bad"]) {
    assert.equal(signalAgeMs({ ts: nowMs - 5000, chainTs: badChainTs }, nowMs), 5000);
  }

  // Valid seconds and milliseconds (numeric and string) must bound age accurately
  const expectedSecAge = nowMs - validSec * 1000;
  assert.equal(signalAgeMs({ ts: nowMs - 2000, chainTs: validSec }, nowMs), expectedSecAge);
  assert.equal(signalAgeMs({ ts: nowMs - 2000, chainTs: String(validSec) }, nowMs), expectedSecAge);
  assert.equal(signalAgeMs({ ts: nowMs - 2000, chainTs: validMs }, nowMs), 15_000);
  assert.equal(signalAgeMs({ ts: nowMs - 2000, chainTs: `  ${validMs}  ` }, nowMs), 15_000);

  // 2) End-to-end Worker webhook ingestion checks (SignalQueueDO)
  const storage = createRealSqliteStorage();
  let doInstance = null;
  const env = {
    HELIUS_AUTH: "secret-helius",
    APP_KEY: "secret-app",
    SIGNAL_QUEUE: {
      idFromName: () => "global-id",
      get: () => {
        if (!doInstance) doInstance = new SignalQueueDO({ storage }, env);
        return doInstance;
      },
    },
  };

  const payloads = [
    { signature: "sig-null", timestamp: null, tokenTransfers: [{ mint: "mint-null" }] },
    { signature: "sig-empty", timestamp: "", tokenTransfers: [{ mint: "mint-empty" }] },
    { signature: "sig-space", timestamp: "   ", tokenTransfers: [{ mint: "mint-space" }] },
    { signature: "sig-bool-t", timestamp: true, tokenTransfers: [{ mint: "mint-bool-t" }] },
    { signature: "sig-bool-f", timestamp: false, tokenTransfers: [{ mint: "mint-bool-f" }] },
    { signature: "sig-arr", timestamp: [validSec], tokenTransfers: [{ mint: "mint-arr" }] },
    { signature: "sig-zero", timestamp: 0, tokenTransfers: [{ mint: "mint-zero" }] },
    { signature: "sig-neg", timestamp: -100, tokenTransfers: [{ mint: "mint-neg" }] },
    { signature: "sig-bad", timestamp: "invalid-ts", tokenTransfers: [{ mint: "mint-bad" }] },
    { signature: "sig-sec", timestamp: validSec, tokenTransfers: [{ mint: "mint-sec" }] },
    { signature: "sig-sec-str", timestamp: String(validSec), tokenTransfers: [{ mint: "mint-sec-str" }] },
    { signature: "sig-ms", timestamp: validMs, tokenTransfers: [{ mint: "mint-ms" }] },
  ];

  const hookRes = await worker.fetch(
    new Request("https://worker.local/hook", {
      method: "POST",
      headers: { authorization: "secret-helius", "content-type": "application/json" },
      body: JSON.stringify(payloads),
    }),
    env,
  );
  assert.equal(hookRes.status, 200);

  const sigRes = await worker.fetch(
    new Request("https://worker.local/signals?since=0", {
      method: "GET",
      headers: { "x-key": "secret-app" },
    }),
    env,
  );
  assert.equal(sigRes.status, 200);
  const { signals } = await sigRes.json();
  assert.equal(signals.length, 12);

  const byMint = Object.fromEntries(signals.map((s) => [s.mint, s]));
  for (const m of [
    "mint-null",
    "mint-empty",
    "mint-space",
    "mint-bool-t",
    "mint-bool-f",
    "mint-arr",
    "mint-zero",
    "mint-neg",
    "mint-bad",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(byMint[m], "chainTs"),
      false,
      `Expected no chainTs on ${m}, got ${byMint[m].chainTs}`,
    );
    const age = signalAgeMs(byMint[m], Date.now());
    assert.ok(age !== null && age >= 0 && age < 5000, `Expected fresh age for ${m}, got ${age}`);
  }

  assert.equal(byMint["mint-sec"].chainTs, validSec);
  assert.equal(byMint["mint-sec"].ts, validSec * 1000);
  assert.equal(byMint["mint-sec-str"].chainTs, validSec);
  assert.equal(byMint["mint-sec-str"].ts, validSec * 1000);
  assert.equal(byMint["mint-ms"].chainTs, validMs);
  assert.equal(byMint["mint-ms"].ts, validMs);
});

test("SignalQueueDO migration and KV fallback preserve alerted TTL accurately, handle <1m/expired/missing keys, do not extend on repeated calls, and fail closed on KV errors", async () => {
  const createMigrationHarness = ({ alertedVal, listKeys, failListOnce = false, failGetAlertedOnce = false }) => {
    const kvStore = new Map([
      ["queue", JSON.stringify({ seq: 4, halt: false, items: [{ id: 4, mint: "mint-4", sig: "sig-4", ts: 1000 }] })],
      ["hb", JSON.stringify({ ts: 5000, open: 1 })],
    ]);
    if (alertedVal !== undefined) {
      kvStore.set("alerted", alertedVal);
    }

    let listCalls = 0;
    let getAlertedCalls = 0;
    let shouldFailList = failListOnce;
    let shouldFailGetAlerted = failGetAlertedOnce;

    const kv = {
      get: async (k, type) => {
        if (k === "alerted") {
          getAlertedCalls += 1;
          if (shouldFailGetAlerted) {
            shouldFailGetAlerted = false;
            throw new Error("KV.get(alerted) transient 503 failure");
          }
        }
        const v = kvStore.get(k);
        if (v === undefined || v === null) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
      list:
        listKeys !== null
          ? async ({ prefix } = {}) => {
              listCalls += 1;
              if (shouldFailList) {
                shouldFailList = false;
                throw new Error("KV.list(alerted) transient 503 failure");
              }
              return {
                keys: listKeys.filter((k) => !prefix || k.name.startsWith(prefix)),
              };
            }
          : undefined,
    };

    const storage = createRealSqliteStorage();
    let doInstance = null;
    const env = {
      HELIUS_AUTH: "secret-helius",
      APP_KEY: "secret-app",
      KV: kv,
      SIGNAL_QUEUE: {
        idFromName: () => "global-id",
        get: () => {
          if (!doInstance) doInstance = new SignalQueueDO({ storage }, env);
          return doInstance;
        },
      },
    };

    const exportSnapshot = () =>
      worker.fetch(
        new Request("https://worker.local/export-kv", {
          method: "GET",
          headers: { "x-key": "secret-app" },
        }),
        env,
      );

    return {
      env,
      storage,
      exportSnapshot,
      getStats: () => ({ listCalls, getAlertedCalls }),
    };
  };

  const nowSec = Math.floor(Date.now() / 1000);

  // 1) Missing 'alerted' key -> alerted=false, alertedUntil=0, alertedRemainingSec=0, alertedTtlSec=0
  {
    const h = createMigrationHarness({ alertedVal: undefined, listKeys: [] });
    const res = await h.exportSnapshot();
    assert.equal(res.status, 200);
    const snap = await res.json();
    assert.equal(snap.alerted, false);
    assert.equal(snap.alertedUntil, 0);
    assert.equal(snap.alertedRemainingSec, 0);
    assert.equal(snap.alertedTtlSec, 0);
  }

  // 2) Active 'alerted' key with a long remaining TTL (2400s = 40 min) -> preserves ~2400s, never extended to 3600s
  {
    const targetExpSec = nowSec + 2400;
    const h = createMigrationHarness({
      alertedVal: "1",
      listKeys: [{ name: "alerted", expiration: targetExpSec }],
    });
    const res = await h.exportSnapshot();
    assert.equal(res.status, 200);
    const snap = await res.json();
    assert.equal(snap.alerted, true);
    assert.equal(snap.alertedUntil, targetExpSec * 1000);
    assert.ok(snap.alertedRemainingSec >= 2395 && snap.alertedRemainingSec <= 2400);
    assert.equal(snap.alertedTtlSec, snap.alertedRemainingSec);
  }

  // 3) Active 'alerted' key with LESS than 1 minute remaining (25s) ->
  //    preserves exact alertedUntil (targetExpSec * 1000) and alertedRemainingSec (~25s),
  //    while alertedTtlSec respects Cloudflare KV's 60s minimum floor for KV put rollback.
  {
    const targetExpSec = nowSec + 25;
    const h = createMigrationHarness({
      alertedVal: "1",
      listKeys: [{ name: "alerted", expiration: targetExpSec }],
    });
    const res = await h.exportSnapshot();
    assert.equal(res.status, 200);
    const snap = await res.json();
    assert.equal(snap.alerted, true);
    assert.equal(snap.alertedUntil, targetExpSec * 1000);
    assert.ok(snap.alertedRemainingSec >= 20 && snap.alertedRemainingSec <= 25);
    assert.equal(snap.alertedTtlSec, 60);
  }

  // 4) Expired key in KV (expiration <= nowSec) OR legacy "1" without expiration metadata ->
  //    never invents a +3600s suppression window
  {
    const hExpired = createMigrationHarness({
      alertedVal: "1",
      listKeys: [{ name: "alerted", expiration: nowSec - 5 }],
    });
    const expSnap = await (await hExpired.exportSnapshot()).json();
    assert.equal(expSnap.alerted, false);
    assert.equal(expSnap.alertedUntil, 0);
    assert.equal(expSnap.alertedRemainingSec, 0);
    assert.equal(expSnap.alertedTtlSec, 0);

    const hNoMeta = createMigrationHarness({
      alertedVal: "1",
      listKeys: null,
    });
    const noMetaSnap = await (await hNoMeta.exportSnapshot()).json();
    assert.equal(noMetaSnap.alerted, false);
    assert.equal(noMetaSnap.alertedUntil, 0);
    assert.equal(noMetaSnap.alertedTtlSec, 0);
  }

  // 5) Repeated migration attempts / cold-start DO reconstructions do NOT re-read KV or extend alerted_until
  {
    const targetExpSec = nowSec + 300;
    const h = createMigrationHarness({
      alertedVal: "1",
      listKeys: [{ name: "alerted", expiration: targetExpSec }],
    });
    const snap1 = await (await h.exportSnapshot()).json();
    assert.equal(snap1.alertedUntil, targetExpSec * 1000);
    assert.equal(h.getStats().listCalls, 1);

    // Second request on same DO instance + third request on a newly constructed DO instance sharing SQLite storage
    const snap2 = await (await h.exportSnapshot()).json();
    const restartedDo = new SignalQueueDO({ storage: h.storage }, h.env);
    const snap3 = await (
      await restartedDo.fetch(new Request("https://worker.local/export-kv", { method: "GET" }))
    ).json();

    assert.equal(snap2.alertedUntil, targetExpSec * 1000);
    assert.equal(snap3.alertedUntil, targetExpSec * 1000);
    assert.equal(h.getStats().listCalls, 1);
  }

  // 6) Storage/read failures on KV.get("alerted") or KV.list({ prefix: "alerted" }) MUST fail closed (HTTP 503)
  //    without marking migrated_from_kv="1", and succeed cleanly on retry
  {
    const targetExpSec = nowSec + 900;
    const hFailGet = createMigrationHarness({
      alertedVal: "1",
      listKeys: [{ name: "alerted", expiration: targetExpSec }],
      failGetAlertedOnce: true,
    });
    const failRes1 = await hFailGet.exportSnapshot();
    assert.equal(failRes1.status, 503);
    const okRes1 = await hFailGet.exportSnapshot();
    assert.equal(okRes1.status, 200);
    assert.equal((await okRes1.json()).alertedUntil, targetExpSec * 1000);

    const hFailList = createMigrationHarness({
      alertedVal: "1",
      listKeys: [{ name: "alerted", expiration: targetExpSec }],
      failListOnce: true,
    });
    const failRes2 = await hFailList.exportSnapshot();
    assert.equal(failRes2.status, 503);
    const okRes2 = await hFailList.exportSnapshot();
    assert.equal(okRes2.status, 200);
    assert.equal((await okRes2.json()).alertedUntil, targetExpSec * 1000);
  }
});

test("Worker auth timingSafeEqualString and webhook batch/size limits", async () => {
  // 1) Constant-time auth comparison unit tests
  assert.equal(await timingSafeEqualString("secret-123", "secret-123"), true);
  assert.equal(await timingSafeEqualString("secret-123", "secret-124"), false);
  assert.equal(await timingSafeEqualString("secret-123", "secret-12"), false);
  assert.equal(await timingSafeEqualString("", "secret-123"), false);
  assert.equal(await timingSafeEqualString(null, "secret-123"), false);
  assert.equal(await timingSafeEqualString(undefined, "secret-123"), false);

  // 2) Worker /hook batch limit (cap at 100 transactions)
  let doInstance = null;
  const storage = createRealSqliteStorage();
  const env = {
    HELIUS_AUTH: "test-helius-key",
    APP_KEY: "test-app-key",
    SIGNAL_QUEUE: {
      idFromName: () => "global-id",
      get: () => {
        if (!doInstance) doInstance = new SignalQueueDO({ storage }, env);
        return doInstance;
      },
    },
  };

  const oversizedBatch = Array.from({ length: 101 }, (_, i) => ({
    signature: `sig-${i}`,
    tokenTransfers: [{ mint: `mint-${i}` }],
  }));

  const batchLimitRes = await worker.fetch(
    new Request("https://worker.local/hook", {
      method: "POST",
      headers: {
        authorization: "test-helius-key",
        "content-type": "application/json",
      },
      body: JSON.stringify(oversizedBatch),
    }),
    env,
  );
  assert.equal(batchLimitRes.status, 400);
  const batchErr = await batchLimitRes.json();
  assert.equal(batchErr.error, "batch_limit_exceeded");
  assert.equal(batchErr.max, 100);
  assert.equal(batchErr.received, 101);

  // 3) Payload byte size limit (> 256 KB)
  const hugePayload = "x".repeat(300 * 1024);
  const sizeLimitRes = await worker.fetch(
    new Request("https://worker.local/hook", {
      method: "POST",
      headers: {
        authorization: "test-helius-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ huge: hugePayload }),
    }),
    env,
  );
  assert.equal(sizeLimitRes.status, 413);
  assert.equal((await sizeLimitRes.json()).error, "payload_too_large");

  // 4) Unauthorized /hook rejection
  const unauthorizedRes = await worker.fetch(
    new Request("https://worker.local/hook", {
      method: "POST",
      headers: {
        authorization: "wrong-auth",
        "content-type": "application/json",
      },
      body: JSON.stringify([]),
    }),
    env,
  );
  assert.equal(unauthorizedRes.status, 401);
});
