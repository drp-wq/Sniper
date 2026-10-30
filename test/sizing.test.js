import test from "node:test";
import assert from "node:assert/strict";
import { computeKellySize, computeFixedFractionSize } from "../src/sizing.js";

test("computeKellySize: calculates mathematically correct fractional Kelly allocation", () => {
  // Win rate 50%, avgWin 100%, avgLoss 25% (b = 4)
  // Kelly f* = (0.5 * 5 - 1) / 4 = 1.5 / 4 = 0.375 (37.5%)
  // Quarter-Kelly (0.25) = 0.09375 (9.375%)
  // Capped at maxExposureFraction (0.02)
  const res = computeKellySize({
    capital: 1000,
    winRate: 0.50,
    avgWin: 100,
    avgLoss: 25,
    kellyFraction: 0.25,
    maxExposureFraction: 0.02,
  });

  assert.equal(res.reason, "approved");
  assert.equal(res.fraction, 0.02); // Capped at 2%
  assert.equal(res.allocatedUsd, 20); // 2% of $1000
});

test("computeKellySize: strictly returns zero on non-positive expectancy", () => {
  // Win rate 20%, avgWin 50%, avgLoss 50% (b = 1)
  // Kelly f* = (0.2 * 2 - 1) / 1 = -0.6 (negative)
  const res = computeKellySize({
    capital: 1000,
    winRate: 0.20,
    avgWin: 50,
    avgLoss: 50,
  });

  assert.equal(res.fraction, 0);
  assert.equal(res.allocatedUsd, 0);
  assert.equal(res.reason, "negative_expectancy_kelly");
});

test("computeKellySize: dampens size as daily drawdown approaches limit", () => {
  // Capital $1000, daily loss $400 out of $500 max (80% of limit consumed)
  // Drawdown safety scale = 1 - (400 / 500) = 0.20
  const res = computeKellySize({
    capital: 1000,
    winRate: 0.60,
    avgWin: 80,
    avgLoss: 20,
    currentDailyLoss: 400,
    maxDailyLoss: 0.50,
    maxExposureFraction: 0.05,
  });

  assert.equal(res.reason, "approved");
  assert.equal(res.drawdownSafetyScale, 0.20);
  assert.ok(res.fraction < 0.05); // Exposure dampened
});

test("computeKellySize: halts completely when daily drawdown limit is reached or exceeded", () => {
  const res = computeKellySize({
    capital: 1000,
    winRate: 0.70,
    avgWin: 100,
    avgLoss: 20,
    currentDailyLoss: 500, // 50% loss reached
    maxDailyLoss: 0.50,
  });

  assert.equal(res.fraction, 0);
  assert.equal(res.allocatedUsd, 0);
  assert.equal(res.reason, "daily_drawdown_limit_reached");
});

test("computeFixedFractionSize: allocates exact capped fraction and respects drawdown dampening", () => {
  const resNormal = computeFixedFractionSize({
    capital: 2000,
    fixedFraction: 0.015,
    maxExposureFraction: 0.02,
  });
  assert.equal(resNormal.allocatedUsd, 30); // 1.5% of $2000
  assert.equal(resNormal.fraction, 0.015);

  const resDampened = computeFixedFractionSize({
    capital: 2000,
    fixedFraction: 0.015,
    currentDailyLoss: 500, // 50% of $1000 allowed
    maxDailyLoss: 0.50,
  });
  assert.equal(resDampened.drawdownSafetyScale, 0.50);
  assert.equal(resDampened.fraction, 0.0075);
  assert.equal(resDampened.allocatedUsd, 15);
});

test("Property Test: Sizing invariant bounds hold across 500 randomized parameter sweeps", () => {
  for (let i = 0; i < 500; i++) {
    const capital = 100 + Math.random() * 50000;
    const winRate = 0.05 + Math.random() * 0.90;
    const avgWin = 10 + Math.random() * 200;
    const avgLoss = 10 + Math.random() * 100;
    const currentDailyLoss = Math.random() * capital * 0.6;
    const maxDailyLoss = 0.30 + Math.random() * 0.40;
    const maxExposure = 0.01 + Math.random() * 0.05;

    const res = computeKellySize({
      capital,
      winRate,
      avgWin,
      avgLoss,
      currentDailyLoss,
      maxDailyLoss,
      maxExposureFraction: maxExposure,
    });

    // Invariant 1: Allocated USD must never exceed capital * maxExposure
    assert.ok(res.allocatedUsd <= capital * maxExposure + 0.01);
    // Invariant 2: Allocated USD must never be negative
    assert.ok(res.allocatedUsd >= 0);
    // Invariant 3: If daily loss >= maxDailyLoss, allocation must be strictly zero
    if (currentDailyLoss / capital >= maxDailyLoss) {
      assert.equal(res.allocatedUsd, 0);
      assert.equal(res.reason, "daily_drawdown_limit_reached");
    }
  }
});
