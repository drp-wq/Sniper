import test from "node:test";
import assert from "node:assert/strict";
import { signalAgeMs, signalKey, sequenceGap } from "../src/signals.js";
import { loadConfig, parseNum } from "../src/config.js";
import { openPaper, openCount, isOpen, _resetPaperStateForTests } from "../src/paper.js";
import { handle, pollOnce, shutdown, _resetMainStateForTests } from "../src/main.js";
import worker from "../worker/index.js";

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
