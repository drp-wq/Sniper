import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectPair } from "../src/price.js";
import { pollOnce, _resetMainStateForTests } from "../src/main.js";
import {
  openPaper,
  tick,
  evaluate,
  computeDoubleSlipPnl,
  loadPositions,
  savePositions,
  openCount,
  isOpen,
  getOpenPositions,
  getArchivedPositions,
  getConsumerState,
  setConsumerState,
  isSignalProcessed,
  _resetPaperStateForTests,
} from "../src/paper.js";

test("selectPair prefers entry pairAddress when still valid and flags fallback when switched", () => {
  const pairs = [
    { chainId: "solana", pairAddress: "pair-A", priceUsd: "1.00", liquidity: { usd: 20000 } },
    { chainId: "solana", pairAddress: "pair-B", priceUsd: "1.50", liquidity: { usd: 50000 } },
  ];

  // Initial entry selects highest liquidity (pair-B)
  const initial = selectPair(pairs);
  assert.equal(initial.pair, "pair-B");
  assert.equal(initial.price, 1.5);
  assert.equal(initial.pairSwitched, false);

  // Subsequent quote with preferredPair="pair-A" stays on pair-A even though pair-B has higher liquidity
  const sticky = selectPair(pairs, "pair-A");
  assert.equal(sticky.pair, "pair-A");
  assert.equal(sticky.price, 1.0);
  assert.equal(sticky.pairSwitched, false);

  // If preferredPair disappears, falls back to highest liquidity and sets pairSwitched=true
  const switched = selectPair(pairs, "pair-missing");
  assert.equal(switched.pair, "pair-B");
  assert.equal(switched.pairSwitched, true);
});

test("missing quotes do not fabricate a -100% total loss, reset missingSince on recovery, and can close cleanly", async () => {
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const notifyFn = () => {};

  await openPaper(
    "mint-missing",
    "sig-m1",
    { signalId: 10 },
    {
      getQuote: async () => ({ price: 1.0, liqUsd: 25000, pair: "pair-1" }),
      log: logFn,
      notify: notifyFn,
      entrySlip: 0.05,
      stateFile: null,
      now: () => 1000,
    },
  );
  assert.equal(openCount(), 1);

  // Simulate 3 missing quotes with noQuoteTicks = 3 (not yet reaching maxUnresolvedMin = 30)
  for (let i = 1; i <= 3; i++) {
    await tick({
      getQuote: async () => null,
      log: logFn,
      notify: notifyFn,
      stateFile: null,
      noQuoteTicks: 3,
      maxUnresolvedMin: 30,
      now: () => 1000 + i * 5000,
    });
  }

  // Position MUST remain open (not closed at -100%) and emit paper_unresolved once
  assert.equal(openCount(), 1);
  assert.equal(events.some((e) => e.ev === "paper_close"), false);
  const unresolved = events.filter((e) => e.ev === "paper_unresolved");
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].misses, 3);
  assert.equal(unresolved[0].missingSince, 6000);
  assert.equal(unresolved[0].lastQuotePrice, 1.0);

  // Quote recovers at t=25000 (price still in band -> stays open and resets missingSince)
  await tick({
    getQuote: async () => ({ price: 1.1, liqUsd: 25000, pair: "pair-1" }),
    log: logFn,
    notify: notifyFn,
    stateFile: null,
    noQuoteTicks: 3,
    maxUnresolvedMin: 30,
    exitSlip: 0.08,
    now: () => 25000,
  });

  const openAfterRecovery = getOpenPositions()[0];
  assert.equal(openAfterRecovery.misses, 0);
  assert.equal(openAfterRecovery.missingSince, null);
  assert.equal(openAfterRecovery.unresolvedMissingQuote, false);

  const recovered = events.find((e) => e.ev === "paper_quote_recovered");
  assert.ok(recovered);
  assert.equal(recovered.missesBeforeRecovery, 3);
  assert.equal(recovered.missingDurationSec, 19);

  // Next tick triggers stop-loss cleanly with real quote
  await tick({
    getQuote: async () => ({ price: 0.5, liqUsd: 25000, pair: "pair-1" }),
    log: logFn,
    notify: notifyFn,
    stateFile: null,
    noQuoteTicks: 3,
    exitSlip: 0.08,
    now: () => 30000,
  });

  assert.equal(openCount(), 0);
  const closed = events.find((e) => e.ev === "paper_close");
  assert.ok(closed);
  assert.equal(closed.reason, "stop_loss");
  assert.notEqual(closed.pnl, -100);
  _resetPaperStateForTests();
});

test("long-unresolved positions archive safely after maxUnresolvedMin, never resurrect on restart, and keep slot on disk failure", async () => {
  _resetPaperStateForTests();
  const dir = mkdtempSync(join(tmpdir(), "sniper-archive-test-"));
  const stateFile = join(dir, "positions.json");
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const notifyFn = () => {};

  try {
    // Open position at t=1000 with maxOpen=1
    await openPaper(
      "mint-zombie",
      "sig-z1",
      { signalId: 50 },
      {
        getQuote: async () => ({ price: 1.0, liqUsd: 30000, pair: "pair-z" }),
        log: logFn,
        notify: notifyFn,
        maxOpen: 1,
        entrySlip: 0.05,
        stateFile,
        now: () => 1000,
      },
    );

    // Take partial profit (+100%) at t=5000 so realizedBankedPct > 0
    await tick({
      getQuote: async () => ({ price: 2.5, liqUsd: 40000, pair: "pair-z" }),
      log: logFn,
      notify: notifyFn,
      stateFile,
      exitSlip: 0.08,
      now: () => 5000,
    });
    assert.equal(getOpenPositions()[0].tookHalf, true);

    // Miss quotes starting at t=10_000 (misses=1, missingSince=10_000) and reach noQuoteTicks=2 at t=15_000
    await tick({
      getQuote: async () => null,
      log: logFn,
      notify: notifyFn,
      stateFile,
      noQuoteTicks: 2,
      maxUnresolvedMin: 30,
      now: () => 10000,
    });
    await tick({
      getQuote: async () => null,
      log: logFn,
      notify: notifyFn,
      stateFile,
      noQuoteTicks: 2,
      maxUnresolvedMin: 30,
      now: () => 15000,
    });
    assert.equal(openCount(), 1);
    assert.equal(events.some((e) => e.ev === "paper_unresolved"), true);

    // At t = 10_000 + 30*60_000 = 1_810_000, simulate disk persistence failure first:
    // Slot MUST NOT be freed and paper_archived_unresolved MUST NOT be emitted if savePositions fails
    await tick({
      getQuote: async () => null,
      log: logFn,
      notify: notifyFn,
      stateFile,
      noQuoteTicks: 2,
      maxUnresolvedMin: 30,
      now: () => 1810000,
      writeFileSync: () => {
        throw new Error("simulated disk full");
      },
    });
    assert.equal(openCount(), 1);
    assert.equal(events.some((e) => e.ev === "paper_archived_unresolved"), false);

    // Now allow disk write to succeed at t = 1_815_000:
    await tick({
      getQuote: async () => null,
      log: logFn,
      notify: notifyFn,
      stateFile,
      noQuoteTicks: 2,
      maxUnresolvedMin: 30,
      now: () => 1815000,
    });

    // Active slot is now freed, paper_archived_unresolved is emitted, and paper_close is NEVER emitted
    assert.equal(openCount(), 0);
    assert.equal(events.some((e) => e.ev === "paper_close"), false);
    const archEv = events.find((e) => e.ev === "paper_archived_unresolved");
    assert.ok(archEv);
    assert.equal(archEv.mint, "mint-zombie");
    assert.equal(archEv.tookHalf, true);
    assert.ok(archEv.realizedBankedPct > 50);
    assert.equal(archEv.missingDurationSec, 1805);

    const archivedInMemory = getArchivedPositions();
    assert.equal(archivedInMemory.length, 1);
    assert.equal(archivedInMemory[0].mint, "mint-zombie");

    // Simulate restart and verify archived position is NOT resurrected into active positions
    _resetPaperStateForTests();
    const restored = loadPositions(stateFile, { log: logFn, maxOpen: 5 });
    assert.equal(restored, 0);
    assert.equal(openCount(), 0);
    assert.equal(getArchivedPositions().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetPaperStateForTests();
  }
});

test("openPaper retries missing entry quotes up to entryQuoteRetries and aborts immediately if HALT activates", async () => {
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const notifyFn = () => {};

  // 1) Succeeds on 2nd attempt after 1 initial null quote
  let calls = 0;
  await openPaper(
    "mint-retry-ok",
    "sig-r1",
    { signalId: 88 },
    {
      getQuote: async () => {
        calls += 1;
        if (calls === 1) return null;
        return { price: 1.0, liqUsd: 25000, pair: "pair-r1" };
      },
      sleep: async () => {},
      isHalted: () => false,
      log: logFn,
      notify: notifyFn,
      entryQuoteRetries: 2,
      entryQuoteRetryMs: 10,
      stateFile: null,
    },
  );
  assert.equal(calls, 2);
  assert.equal(openCount(), 1);
  const openEv = events.find((e) => e.ev === "paper_open" && e.mint === "mint-retry-ok");
  assert.ok(openEv);
  assert.equal(openEv.quoteAttempts, 2);

  // 2) HALT activates during retry wait -> aborts with halted_skip and releases opening lock
  let halted = false;
  await openPaper(
    "mint-retry-halt",
    "sig-r2",
    { signalId: 89 },
    {
      getQuote: async () => null,
      sleep: async () => {
        halted = true;
      },
      isHalted: () => halted,
      log: logFn,
      notify: notifyFn,
      entryQuoteRetries: 2,
      entryQuoteRetryMs: 10,
      stateFile: null,
    },
  );
  assert.equal(isOpen("mint-retry-halt"), false);
  const haltSkip = events.find((e) => e.ev === "halted_skip" && e.mint === "mint-retry-halt");
  assert.ok(haltSkip);
  assert.equal(haltSkip.reason, "halt_after_quote_retry_wait");
  _resetPaperStateForTests();
});

test("partial take-profit + trailing stop and doubled-slippage PnL calculation are accurate", async () => {
  _resetPaperStateForTests();
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });
  const notifyFn = () => {};

  // Open at raw quote 1.00 -> entry = 1.05 (with 5% entrySlip)
  await openPaper(
    "mint-tp",
    "sig-tp",
    { signalId: 20 },
    {
      getQuote: async () => ({ price: 1.0, liqUsd: 30000, pair: "pair-tp" }),
      log: logFn,
      notify: notifyFn,
      entrySlip: 0.05,
      stateFile: null,
      now: () => 1000,
    },
  );

  // Price rises to 2.50 -> exec px = 2.50 * 0.92 = 2.30 -> +119.05% (> +100% takeProfit)
  // Takes half and arms trailing stop (peak = 2.30)
  await tick({
    getQuote: async () => ({ price: 2.5, liqUsd: 40000, pair: "pair-tp" }),
    log: logFn,
    notify: notifyFn,
    stateFile: null,
    exitSlip: 0.08,
    now: () => 6000,
  });

  assert.equal(openCount(), 1);
  const partial = events.find((e) => e.ev === "paper_partial");
  assert.ok(partial);
  assert.equal(partial.reason, "take_profit_half");

  // Price pulls back to 1.90 -> exec px = 1.90 * 0.92 = 1.748 (<= 2.30 * 0.80 = 1.84) -> trailing_stop exit
  await tick({
    getQuote: async () => ({ price: 1.9, liqUsd: 35000, pair: "pair-tp" }),
    log: logFn,
    notify: notifyFn,
    stateFile: null,
    exitSlip: 0.08,
    now: () => 12000,
  });

  assert.equal(openCount(), 0);
  const closed = events.find((e) => e.ev === "paper_close");
  assert.ok(closed);
  assert.equal(closed.reason, "trailing_stop");
  assert.ok(closed.pnl > 80);
  assert.ok(Number.isFinite(closed.pnl2xSlip));
  assert.ok(closed.pnl2xSlip < closed.pnl);
  _resetPaperStateForTests();
});

test("positions persist to disk and recover safely on restart without duplication", async () => {
  _resetPaperStateForTests();
  const dir = mkdtempSync(join(tmpdir(), "sniper-paper-test-"));
  const stateFile = join(dir, "positions.json");
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });

  try {
    await openPaper(
      "mint-persist",
      "sig-p1",
      { signalId: 77 },
      {
        getQuote: async () => ({ price: 2.0, liqUsd: 50000, pair: "pair-p1" }),
        log: logFn,
        notify: () => {},
        entrySlip: 0.05,
        stateFile,
        now: () => 5000,
      },
    );
    assert.equal(openCount(), 1);

    // Simulate process restart by clearing in-memory state and loading from disk
    _resetPaperStateForTests();
    assert.equal(openCount(), 0);

    const restoredCount = loadPositions(stateFile, { log: logFn, maxOpen: 5 });
    assert.equal(restoredCount, 1);
    assert.equal(openCount(), 1);
    assert.equal(isOpen("mint-persist"), true);

    const openList = getOpenPositions();
    assert.equal(openList[0].mint, "mint-persist");
    assert.equal(openList[0].pair, "pair-p1");
    assert.equal(openList[0].entry, 2.1);

    // Verify corrupt state file fails closed without crashing
    _resetPaperStateForTests();
    writeFileSync(stateFile, "{corrupt-json", "utf8");
    const badRestore = loadPositions(stateFile, { log: logFn, maxOpen: 5 });
    assert.equal(badRestore, 0);
    assert.equal(openCount(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetPaperStateForTests();
  }
});

test("persisted consumer cursor and processed signal keys prevent duplicate paper entry across restart even after position closes", async () => {
  _resetPaperStateForTests();
  const dir = mkdtempSync(join(tmpdir(), "sniper-dedup-restart-"));
  const stateFile = join(dir, "positions.json");
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });

  try {
    // 1) Open position for (mint-dup, sig-dup-1)
    await openPaper(
      "mint-dup",
      "sig-dup-1",
      { signalId: 12, signalKey: "sig-dup-1:mint-dup" },
      {
        getQuote: async () => ({ price: 1.0, liqUsd: 30000, pair: "pair-d" }),
        log: logFn,
        notify: () => {},
        entrySlip: 0.05,
        stateFile,
        now: () => 1000,
      },
    );
    assert.equal(openCount(), 1);

    // 2) Close position via stop-loss so it is no longer in active positions
    await tick({
      getQuote: async () => ({ price: 0.5, liqUsd: 30000, pair: "pair-d" }),
      log: logFn,
      notify: () => {},
      stateFile,
      exitSlip: 0.08,
      now: () => 5000,
    });
    assert.equal(openCount(), 0);

    // 3) Simulate process restart and load persisted state
    _resetPaperStateForTests();
    loadPositions(stateFile, { log: logFn, maxOpen: 5 });

    // 4) Re-playing the same signal (sig-dup-1, mint-dup) must be rejected as duplicate
    await openPaper(
      "mint-dup",
      "sig-dup-1",
      { signalId: 12, signalKey: "sig-dup-1:mint-dup" },
      {
        getQuote: async () => ({ price: 1.0, liqUsd: 30000, pair: "pair-d" }),
        log: logFn,
        notify: () => {},
        entrySlip: 0.05,
        stateFile,
        now: () => 6000,
      },
    );
    assert.equal(openCount(), 0);
    const dupEv = events.find((e) => e.ev === "signal_duplicate" && e.reason === "signal_already_processed");
    assert.ok(dupEv);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetPaperStateForTests();
  }
});

test("openPaper and close roll back in-memory state when savePositions fails, and loadPositions resets stale consumer state", async () => {
  _resetPaperStateForTests();
  const dir = mkdtempSync(join(tmpdir(), "sniper-disk-fail-"));
  const stateFile = join(dir, "positions.json");
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });

  try {
    // 1) Disk write failure during openPaper must roll back position and processedSignals
    const failOpenRes = await openPaper(
      "mint-disk-fail",
      "sig-df-1",
      { signalId: 1, signalKey: "sig-df-1:mint-disk-fail" },
      {
        getQuote: async () => ({ price: 1.0, liqUsd: 30000, pair: "pair-df" }),
        log: logFn,
        notify: () => {},
        entrySlip: 0.05,
        stateFile,
        writeFileSync: () => {
          throw new Error("ENOSPC: no space left on device");
        },
        now: () => 1000,
      },
    );

    assert.equal(failOpenRes.ok, false);
    assert.equal(failOpenRes.retryable, true);
    assert.equal(openCount(), 0);
    assert.equal(isSignalProcessed("sig-df-1:mint-disk-fail"), false);
    assert.equal(events.some((e) => e.ev === "paper_open"), false);

    // 2) Now allow disk write to succeed -> position opens and persists
    const okOpenRes = await openPaper(
      "mint-disk-fail",
      "sig-df-1",
      { signalId: 1, signalKey: "sig-df-1:mint-disk-fail" },
      {
        getQuote: async () => ({ price: 1.0, liqUsd: 30000, pair: "pair-df" }),
        log: logFn,
        notify: () => {},
        entrySlip: 0.05,
        stateFile,
        now: () => 2000,
      },
    );
    assert.equal(okOpenRes.ok, true);
    assert.equal(openCount(), 1);
    assert.equal(isSignalProcessed("sig-df-1:mint-disk-fail"), true);

    // 3) Simulate disk write failure during close (stop_loss) -> position must remain open in memory
    await tick({
      getQuote: async () => ({ price: 0.5, liqUsd: 30000, pair: "pair-df" }),
      log: logFn,
      notify: () => {},
      stateFile,
      exitSlip: 0.08,
      writeFileSync: () => {
        throw new Error("ENOSPC on close");
      },
      now: () => 5000,
    });
    assert.equal(openCount(), 1);
    assert.equal(events.some((e) => e.ev === "paper_close"), false);

    // 4) Verify loadPositions resets stale higher in-memory consumerSince/seenKeys to match loaded file
    setConsumerState({ since: 99, seenKeys: ["stale-key:mint-stale"] });
    assert.equal(getConsumerState().since, 99);

    loadPositions(stateFile, { log: logFn, maxOpen: 5 });
    assert.equal(getConsumerState().since, 0);
    assert.equal(isSignalProcessed("stale-key:mint-stale"), false);
    assert.equal(isSignalProcessed("sig-df-1:mint-disk-fail"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetPaperStateForTests();
  }
});

test("pollOnce preserves mid-batch openPaper deduplication state when end-of-batch cursor save fails, across both next poll and restart", async () => {
  _resetPaperStateForTests();
  _resetMainStateForTests(39);
  setConsumerState({ since: 39, seenKeys: [], reset: true });

  const dir = mkdtempSync(join(tmpdir(), "sniper-midbatch-consistency-"));
  const stateFile = join(dir, "positions.json");
  const events = [];
  const logFn = (ev, data) => events.push({ ev, ...data });

  try {
    let writeCalls = 0;
    let gate41Calls = 0;
    const signalsBatch = [
      { id: 40, mint: "mint-40-open", sig: "sig-40", ts: 95000 },
      { id: 41, mint: "mint-41-gate", sig: "sig-41", ts: 95000 },
    ];

    // Poll 1:
    // - Signal 40 opens a paper position and its mid-batch savePositions succeeds (writeCalls === 1).
    // - Signal 41 is evaluated by the gate (rejected, no mid-batch save).
    // - End-of-batch cursor savePositions fails (writeCalls === 2 throws EIO).
    await pollOnce({
      stateFile,
      writeFileSync: (file, data, enc) => {
        writeCalls += 1;
        if (writeCalls === 2) {
          throw new Error("EIO: end-of-batch cursor write failed");
        }
        return writeFileSync(file, data, enc);
      },
      getSignals: async (since) => {
        assert.equal(since, 39);
        return {
          seq: 41,
          oldestId: 40,
          halt: false,
          signals: signalsBatch,
        };
      },
      runGate: async (mint) => {
        if (mint === "mint-40-open") {
          return { pass: true, reasons: [], top10Pct: 15 };
        }
        gate41Calls += 1;
        return { pass: false, reasons: ["lp_not_burned"], top10Pct: 50 };
      },
      getQuote: async () => ({ price: 1.0, liqUsd: 35000, pair: "pair-40" }),
      notify: () => {},
      isHalted: () => false,
      log: logFn,
      maxSignalAgeMs: 60000,
      now: () => 100000,
    });

    assert.equal(writeCalls, 2);
    assert.equal(gate41Calls, 1);
    assert.equal(openCount(), 1);
    assert.equal(isOpen("mint-40-open"), true);

    // Verify mutual consistency between disk, in-memory consumer state, and deduplication keys:
    const diskAfterFail = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.equal(diskAfterFail.positions.length, 1);
    assert.equal(diskAfterFail.positions[0].mint, "mint-40-open");
    assert.equal(diskAfterFail.consumer.since, 39);
    assert.equal(diskAfterFail.consumer.seenKeys.includes("sig-40:mint-40-open"), true);
    assert.equal(diskAfterFail.consumer.seenKeys.includes("queue:40:mint-40-open"), true);
    assert.equal(diskAfterFail.consumer.seenKeys.includes("sig-41:mint-41-gate"), false);

    const memConsumer = getConsumerState();
    assert.equal(memConsumer.since, 39);
    assert.equal(isSignalProcessed("sig-40:mint-40-open"), true);
    assert.equal(isSignalProcessed("queue:40:mint-40-open"), true);
    assert.equal(isSignalProcessed("sig-41:mint-41-gate"), false);

    // Poll 2 (in-process retry without restart):
    // - Signal 40 must be deduplicated immediately (never re-opened),
    // - Signal 41 must NOT be silently skipped (gate runs again),
    // - End-of-batch save succeeds and advances cursor to 41.
    let gate40RetryCalls = 0;
    await pollOnce({
      stateFile,
      getSignals: async (since) => {
        assert.equal(since, 39);
        return {
          seq: 41,
          oldestId: 40,
          halt: false,
          signals: signalsBatch,
        };
      },
      runGate: async (mint) => {
        if (mint === "mint-40-open") {
          gate40RetryCalls += 1;
          return { pass: true, reasons: [], top10Pct: 15 };
        }
        gate41Calls += 1;
        return { pass: false, reasons: ["lp_not_burned"], top10Pct: 50 };
      },
      getQuote: async () => ({ price: 1.0, liqUsd: 35000, pair: "pair-40" }),
      notify: () => {},
      isHalted: () => false,
      log: logFn,
      maxSignalAgeMs: 60000,
      now: () => 101000,
    });

    assert.equal(gate40RetryCalls, 0);
    assert.equal(gate41Calls, 2);
    assert.equal(openCount(), 1);
    assert.equal(getConsumerState().since, 41);
    assert.equal(isSignalProcessed("sig-40:mint-40-open"), true);
    assert.equal(isSignalProcessed("queue:40:mint-40-open"), true);
    assert.equal(isSignalProcessed("sig-41:mint-41-gate"), true);

    // Now test the exact same failure followed by a process restart before Poll 2:
    writeFileSync(stateFile, JSON.stringify(diskAfterFail, null, 2), "utf8");
    _resetPaperStateForTests();
    _resetMainStateForTests(0);

    const restored = loadPositions(stateFile, { log: logFn, maxOpen: 5 });
    assert.equal(restored, 1);
    assert.equal(getConsumerState().since, 39);
    assert.equal(isSignalProcessed("sig-40:mint-40-open"), true);
    assert.equal(isSignalProcessed("queue:40:mint-40-open"), true);
    assert.equal(isSignalProcessed("sig-41:mint-41-gate"), false);

    let gate40RestartCalls = 0;
    let gate41RestartCalls = 0;
    await pollOnce({
      stateFile,
      getSignals: async (since) => {
        assert.equal(since, 39);
        return {
          seq: 41,
          oldestId: 40,
          halt: false,
          signals: signalsBatch,
        };
      },
      runGate: async (mint) => {
        if (mint === "mint-40-open") {
          gate40RestartCalls += 1;
          return { pass: true, reasons: [], top10Pct: 15 };
        }
        gate41RestartCalls += 1;
        return { pass: false, reasons: ["lp_not_burned"], top10Pct: 50 };
      },
      getQuote: async () => ({ price: 1.0, liqUsd: 35000, pair: "pair-40" }),
      notify: () => {},
      isHalted: () => false,
      log: logFn,
      maxSignalAgeMs: 60000,
      now: () => 102000,
    });

    assert.equal(gate40RestartCalls, 0);
    assert.equal(gate41RestartCalls, 1);
    assert.equal(openCount(), 1);
    assert.equal(getConsumerState().since, 41);
    assert.equal(events.filter((e) => e.ev === "paper_open" && e.mint === "mint-40-open").length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    _resetMainStateForTests(0);
    _resetPaperStateForTests();
  }
});
