import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectPair } from "../src/price.js";
import {
  openPaper,
  tick,
  evaluate,
  computeDoubleSlipPnl,
  loadPositions,
  openCount,
  isOpen,
  getOpenPositions,
  getArchivedPositions,
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
