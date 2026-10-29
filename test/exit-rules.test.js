import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../src/paper.js";
import { cfg } from "../src/config.js";

test("evaluate: stop-loss triggers when executable price falls to or below -25%", () => {
  const p = {
    mint: "MintTest111",
    entry: 100,
    peak: 100,
    openedAt: 1000000,
    liq0: 20000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  const qSafe = { price: 85, liqUsd: 20000, pair: "pair1" };
  const resSafe = evaluate(p, qSafe, 1000000 + 10000);
  assert.equal(resSafe, null);

  const qStop = { price: 81, liqUsd: 20000, pair: "pair1" };
  const resStop = evaluate(p, qStop, 1000000 + 20000);
  assert.ok(resStop);
  assert.equal(resStop.exit, "stop_loss");
  assert.ok(resStop.pct <= -25);
});

test("evaluate: liquidity drop triggers when liquidity drops >= 30%", () => {
  const p = {
    mint: "MintTestLiq",
    entry: 100,
    peak: 100,
    openedAt: 1000000,
    liq0: 100000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  const qDrop = { price: 100, liqUsd: 69000, pair: "pair1" };
  const res = evaluate(p, qDrop, 1000000 + 5000);
  assert.ok(res);
  assert.equal(res.exit, "liquidity_drop");
});

test("evaluate: max hold triggers after 30 minutes", () => {
  const p = {
    mint: "MintTestMaxHold",
    entry: 100,
    peak: 100,
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  const qNormal = { price: 110, liqUsd: 50000, pair: "pair1" };
  const resBefore = evaluate(p, qNormal, 1000000 + 29 * 60 * 1000);
  assert.equal(resBefore, null);

  const resAfter = evaluate(p, qNormal, 1000000 + 30 * 60 * 1000);
  assert.ok(resAfter);
  assert.equal(resAfter.exit, "max_hold");
});

test("evaluate: take profit half triggers at +100%", () => {
  const p = {
    mint: "MintTestTP",
    entry: 100,
    peak: 100,
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  const qTP = { price: 220, liqUsd: 60000, pair: "pair1" };
  const res = evaluate(p, qTP, 1000000 + 10000);
  assert.ok(res);
  assert.equal(res.partial, "take_profit_half");
  assert.ok(res.pct >= 100);
});

test("evaluate: trailing stop arms at +50% and exits on 20% pullback from peak", () => {
  const p = {
    mint: "MintTestTrail",
    entry: 100,
    peak: 100,
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: true,
    realized: 50,
    misses: 0,
  };

  const qPump = { price: 175, liqUsd: 60000, pair: "pair1" };
  const res1 = evaluate(p, qPump, 1000000 + 10000);
  assert.equal(res1, null);
  assert.equal(p.trailArmed, true);
  const peakAfterPump = p.peak;

  const pullPx = peakAfterPump * 0.79;
  const qPull = { price: pullPx / (1 - cfg.exitSlip), liqUsd: 60000, pair: "pair1" };
  const res2 = evaluate(p, qPull, 1000000 + 20000);
  assert.ok(res2);
  assert.equal(res2.exit, "trailing_stop");
});

test("evaluate: time-stop triggers on flat price action with calibrated bandDown", () => {
  // Bought with 5% entry slip -> entry = 105.
  // Screen price is flat at 105.
  // Executable price with 8% exit slip: px = 105 * (1 - 0.08) = 96.6.
  // PnL pct = (96.6 / 105 - 1) * 100 = -8.0%.
  // Safely inside configured [-bandDown%, +bandUp%] (default [-10%, +15%]).
  const qFlat = { price: 105, liqUsd: 50000, pair: "pair1" };

  const p = {
    mint: "MintTestTimeStopFlat",
    entry: 105,
    peak: 105,
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  // Verify the test quote produces an executable price strictly inside configured band
  const px = qFlat.price * (1 - cfg.exitSlip);
  const pct = (px / p.entry - 1) * 100;
  assert.ok(
    pct >= -cfg.rules.bandDown && pct <= cfg.rules.bandUp,
    "executable price must be inside configured time-stop band",
  );

  const t0 = 1000000 + 1000;
  const res0 = evaluate(p, qFlat, t0);
  assert.equal(res0, null);
  assert.equal(p.sidewaysSince, t0, "sidewaysSince must be initialized on first in-band observation");

  // Flat before time-stop threshold (179s later)
  const resBefore = evaluate(p, qFlat, t0 + (cfg.rules.timeStopSec - 1) * 1000);
  assert.equal(resBefore, null);

  // Still flat at exactly timeStopSec (180s later)
  const resEnd = evaluate(p, qFlat, t0 + cfg.rules.timeStopSec * 1000);
  assert.ok(resEnd);
  assert.equal(resEnd.exit, "time_stop");
});

test("evaluate: auto-breakeven triggers at <= 0% after takeProfit half is banked", () => {
  const p = {
    mint: "MintAutoBreakeven",
    entry: 100,
    peak: 220,
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: true,
    tookHalf: true, // Already banked 50% at +100%
    realized: 50,
    misses: 0,
  };

  // Price pulls down to entry price (0% profit)
  const qBreakeven = { price: 100 / (1 - cfg.exitSlip), liqUsd: 50000, pair: "pair1" };
  const res = evaluate(p, qBreakeven, 1000000 + 10000);
  assert.ok(res);
  assert.equal(res.exit, "breakeven_stop");
  assert.ok(res.pct <= 0);
});

test("evaluate: dynamic trailing stop tightens to 15% on 2x runners and 10% on 3x+ moonshots", () => {
  // Test 1: Runner pumped to +150% peak (peakPct = 150) -> dynamicTrail is 15%
  const p1 = {
    mint: "MintRunner2x",
    entry: 100,
    peak: 250, // +150% peak
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: true,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  // Pullback 16% from peak (250 * 0.84 = 210) -> with 15% ratchet, triggers exit
  const qPull15 = { price: 210 / (1 - cfg.exitSlip), liqUsd: 50000, pair: "pair1" };
  const res1 = evaluate(p1, qPull15, 1000000 + 5000);
  assert.ok(res1);
  assert.equal(res1.exit, "trailing_stop");

  // Test 2: Moonshot pumped to +300% peak (peakPct = 300) -> dynamicTrail is 10%
  const p2 = {
    mint: "MintMoonshot",
    entry: 100,
    peak: 400, // +300% peak
    openedAt: 1000000,
    liq0: 50000,
    sidewaysSince: null,
    trailArmed: true,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  // Pullback 11% from peak (400 * 0.89 = 356) -> with 10% ratchet, triggers exit
  const qPull10 = { price: 356 / (1 - cfg.exitSlip), liqUsd: 50000, pair: "pair1" };
  const res2 = evaluate(p2, qPull10, 1000000 + 5000);
  assert.ok(res2);
  assert.equal(res2.exit, "trailing_stop");
});

test("evaluate: accelerated liquidity drop triggers at -20% when in profit", () => {
  const p = {
    mint: "MintLiqProfit",
    entry: 100,
    peak: 140,
    openedAt: 1000000,
    liq0: 100000,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,
    misses: 0,
  };

  // In profit (+25%), but liquidity dropped 22% (from 100k to 78k)
  const qDrop = { price: 125 / (1 - cfg.exitSlip), liqUsd: 78000, pair: "pair1" };
  const res = evaluate(p, qDrop, 1000000 + 5000);
  assert.ok(res);
  assert.equal(res.exit, "liquidity_drop");
});
