import test from "node:test";
import assert from "node:assert/strict";
import {
  generateChronologicalDataset,
  executeBacktestTrade,
  computeBacktestMetrics,
  runWalkForwardBacktest
} from "../src/backtest.js";

test("generateChronologicalDataset: constructs survivorship-free time-ordered dataset", () => {
  const dataset = generateChronologicalDataset(100, 42);
  assert.equal(dataset.length, 100);

  // Time-order check: strictly increasing launchTs
  for (let i = 1; i < dataset.length; i++) {
    assert.ok(dataset[i].launchTs > dataset[i - 1].launchTs, "Dataset must be strictly chronologically ordered");
  }

  // Base rate checks: verify scams, dumps, and runners exist
  const scams = dataset.filter((d) => d.archetype === "technical_scam");
  const dumps = dataset.filter((d) => d.archetype === "insider_dump");
  const bleeds = dataset.filter((d) => d.archetype === "slow_bleed");

  assert.ok(scams.length > 20, "Dataset must include realistic proportion of technical scams");
  assert.ok(dumps.length > 20, "Dataset must include insider dumps");
  assert.ok(bleeds.length > 5, "Dataset must include slow bleeds");
});

test("computeBacktestMetrics: calculates correct metrics and bootstrap confidence intervals", () => {
  const sampleTrades = [
    { netPnlPct: 100, netPnlUsd: 20, feeCostUsd: 0.18, exitReason: "take_profit_half" },
    { netPnlPct: -25, netPnlUsd: -5, feeCostUsd: 0.18, exitReason: "stop_loss" },
    { netPnlPct: 50, netPnlUsd: 10, feeCostUsd: 0.18, exitReason: "trailing_stop" },
    { netPnlPct: -25, netPnlUsd: -5, feeCostUsd: 0.18, exitReason: "stop_loss" },
  ];

  const m = computeBacktestMetrics(sampleTrades, 1000);
  assert.equal(m.tradeCount, 4);
  assert.equal(m.winRate, 50); // 2 wins out of 4
  assert.ok(m.expectancy > 0);
  assert.equal(m.profitFactor, 3.0); // 30 / 10
  assert.ok(Array.isArray(m.expectancyCi) && m.expectancyCi.length === 2);
  assert.ok(Array.isArray(m.winRateCi) && m.winRateCi.length === 2);
});

test("runWalkForwardBacktest: executes full walk-forward train/val/test with baselines", () => {
  const res = runWalkForwardBacktest();
  
  assert.equal(res.allVariantsCount, 9);
  assert.ok(res.bestVariant && res.bestVariant.name);
  assert.ok(res.outOfSample.strategy3.tradeCount > 0);
  assert.ok(res.outOfSample.baselineRandom.tradeCount > 0);
  assert.ok(res.outOfSample.baselineLiquidity.tradeCount > 0);

  // Strategy 3 must have a drastically lower rug hit rate than the naive liquidity baseline
  assert.ok(
    res.outOfSample.strategy3.rugHitRate < res.outOfSample.baselineLiquidity.rugHitRate,
    "Strategy 3 safety gate must achieve lower rug hit rate than naive liquidity filter"
  );
});
