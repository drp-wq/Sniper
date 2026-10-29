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
  // Bought at screen price 100.
  // entry = 100 * (1 + 0.05) = 105.
  // Screen price remains completely flat at 100.
  // px = 100 * (1 - 0.08) = 92.
  // pct = (92 / 105 - 1) * 100 = -12.38%.
  // With bandDown: 15, pct is inside [-15%, +15%].
  const qFlat = { price: 100, liqUsd: 50000, pair: "pair1" };

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

  const t0 = 1000000 + 1000;
  const res0 = evaluate(p, qFlat, t0);
  assert.equal(res0, null);
  assert.equal(p.sidewaysSince, t0);

  // Still flat 180s later
  const resEnd = evaluate(p, qFlat, t0 + 180000);
  assert.ok(resEnd);
  assert.equal(resEnd.exit, "time_stop");
});
