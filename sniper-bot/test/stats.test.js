import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, readRows } from "../src/stats.js";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";

test("computeStats: handles empty rows cleanly", () => {
  const stats = computeStats([]);
  assert.equal(stats.gated, 0);
  assert.equal(stats.passed, 0);
  assert.equal(stats.closed, 0);
  assert.equal(stats.winRate, 0);
  assert.equal(stats.mean, 0);
  assert.equal(stats.median, 0);
  assert.equal(stats.best, null);
  assert.equal(stats.worst, null);
  assert.equal(stats.lagMedian, null);
  assert.equal(stats.lagP90, null);
  assert.deepEqual(stats.byReason, {});
});

test("computeStats: correctly computes winRate, mean, median, best, worst, lag stats and byReason", () => {
  const rows = [
    { ev: "gate", pass: true, lagMs: 120 },
    { ev: "gate", pass: false, lagMs: 250 },
    { ev: "gate", pass: true, lagMs: 80 },
    { ev: "paper_close", reason: "take_profit_half", pnl: 45.5 },
    { ev: "paper_close", reason: "trailing_stop", pnl: 20.0 },
    { ev: "paper_close", reason: "stop_loss", pnl: -25.0 },
    { ev: "paper_close", reason: "time_stop", pnl: -5.0 },
  ];

  const s = computeStats(rows);
  assert.equal(s.gated, 3);
  assert.equal(s.passed, 2);
  assert.equal(s.closed, 4);

  // pnls sorted: [-25.0, -5.0, 20.0, 45.5]
  // wins: 20.0, 45.5 => 2 out of 4 = 50%
  assert.equal(s.winRate, 50);

  // sum = 35.5, mean = 35.5 / 4 = 8.875 => 8.88
  assert.equal(s.mean, 8.88);

  // median of 4 items: floor(4/2) = index 2 => 20.00
  assert.equal(s.median, 20.00);

  assert.equal(s.best, 45.5);
  assert.equal(s.worst, -25.0);

  // lags sorted: [80, 120, 250]
  // median of 3: index 1 => 120
  assert.equal(s.lagMedian, 120);
  // p90: index floor(3 * 0.9) = index 2 => 250
  assert.equal(s.lagP90, 250);

  // byReason grouping
  assert.equal(s.byReason.stop_loss.n, 1);
  assert.equal(s.byReason.stop_loss.mean, -25.0);
  assert.equal(s.byReason.take_profit_half.n, 1);
  assert.equal(s.byReason.take_profit_half.mean, 45.5);
});

test("readRows: safely ignores missing file and corrupt JSON lines", () => {
  assert.deepEqual(readRows("non_existent_file.jsonl"), []);

  mkdirSync("logs", { recursive: true });
  const testFile = "logs/test_stats_temp.jsonl";
  writeFileSync(testFile, '{"ev":"gate","pass":true}\ncorrupt json line\n\n{"ev":"gate","pass":false}\n');

  try {
    const rows = readRows(testFile);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].pass, true);
    assert.equal(rows[1].pass, false);
  } finally {
    try { unlinkSync(testFile); } catch {}
  }
});
