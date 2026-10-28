import test from "node:test";
import assert from "node:assert/strict";
import {
  median,
  computeDrawdown,
  parseJsonlText,
  analyzeLogs,
  formatReport,
} from "../src/report.js";

test("median calculates exact middle for odd and average of two middles for even arrays", () => {
  assert.equal(median([]), 0);
  assert.equal(median([10]), 10);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([40, 10, 20, 30]), 25);
  assert.equal(median([10, 20, 90]), 20);
});

test("computeDrawdown tracks both cumulative pct-point drawdown and compounded 10%-stake equity drawdown", () => {
  const dd = computeDrawdown([50, -25, -25, 100], 0.1);
  // Cumulative pct: +50 -> +25 -> 0 (drawdown of 50 pct-pts from peak 50) -> +100
  assert.equal(dd.maxDdPctPoints, 50);
  assert.ok(dd.maxDdEquityPct > 4.5 && dd.maxDdEquityPct < 5.5);
  assert.ok(dd.endingEquityIndex > 105);
});

test("analyzeLogs is backward-compatible with legacy JSONL records, tracks archived unresolved separately, and handles malformed lines safely", () => {
  const rawJsonl = [
    JSON.stringify({ ts: "2026-10-28T00:00:01Z", ev: "gate", mint: "m1", pass: true, lagMs: 1200 }),
    JSON.stringify({ ts: "2026-10-28T00:00:02Z", ev: "gate", mint: "m2", pass: false, receivedAgeMs: 2400 }),
    "{broken-json-line",
    JSON.stringify({ ts: "2026-10-28T00:00:03Z", ev: "paper_open", mint: "m1", entry: 1.05, liqUsd: 20000 }),
    JSON.stringify({ ts: "2026-10-28T00:00:04Z", ev: "paper_open", mint: "m3", entry: 2.1, liqUsd: 30000 }),
    JSON.stringify({ ts: "2026-10-28T00:00:05Z", ev: "paper_open", mint: "m5", entry: 1.0, liqUsd: 25000 }),
    JSON.stringify({ ts: "2026-10-28T00:00:10Z", ev: "paper_unresolved", mint: "m3", misses: 12 }),
    JSON.stringify({ ts: "2026-10-28T00:00:11Z", ev: "paper_unresolved", mint: "m5", misses: 12 }),
    JSON.stringify({ ts: "2026-10-28T00:35:00Z", ev: "paper_archived_unresolved", mint: "m5", tookHalf: true, realizedBankedPct: 50, missingDurationSec: 1800 }),
    // Legacy paper_close without pnl2xSlip
    JSON.stringify({ ts: "2026-10-28T00:00:20Z", ev: "paper_close", mint: "m1", reason: "trailing_stop", pnl: 40, heldSec: 17 }),
    // New paper_close with explicit pnl2xSlip
    JSON.stringify({ ts: "2026-10-28T00:00:30Z", ev: "paper_close", mint: "m4", reason: "stop_loss", pnl: -25, pnl2xSlip: -34.8, heldSec: 12 }),
  ].join("\n");

  const { rows, malformedLines } = parseJsonlText(rawJsonl);
  assert.equal(malformedLines, 1);

  const summary = analyzeLogs(rows, { malformedLines });
  assert.equal(summary.signalsGated, 2);
  assert.equal(summary.signalsPassed, 1);
  assert.equal(summary.lagMedianMs, 1800); // average of 1200 and 2400!
  assert.equal(summary.closedCount, 2); // archived position m5 is NOT counted as a closed trade
  assert.equal(summary.unresolvedOpenCount, 1); // m3 remains open; m5 was archived
  assert.equal(summary.archivedUnresolvedCount, 1);
  assert.equal(summary.archivedBiasWarning, true); // 1 / (2 + 1) = 33.3% > 5%
  assert.equal(summary.meanPnl, 7.5); // primary mean strictly reflects closed trades (40 + -25) / 2
  assert.equal(summary.medianPnl, 7.5); // even-sized median of [40, -25]
  // Stressed PnL for m5 (tookHalf=true, realizedBankedPct=50 -> 50 + 0.5*-100 = 0), so [40, -25, 0] -> mean = 5.0
  assert.equal(summary.stressedMeanPnl, 5);
  assert.equal(summary.stressedMedianPnl, 0);
  assert.ok(summary.meanPnl2x < summary.meanPnl);
  assert.equal(summary.evaluationGate.sampleAdequate, false);
  assert.equal(summary.evaluationGate.passesEvalGate, false);

  const formatted = formatReport(summary);
  assert.ok(formatted.includes("2x Slippage sensitivity"));
  assert.ok(formatted.includes("Worst-case unresolved stress estimate"));
  assert.ok(formatted.includes("Bias warning:"));
  assert.ok(formatted.includes("Evaluation gate (>=200 trades"));
});

test("analyzeLogs combines and deduplicates archived positions from both log events and state file", () => {
  const rows = [
    { ev: "paper_open", mint: "m1" },
    { ev: "paper_archived_unresolved", mint: "m1", sig: "sig1", signalId: 101, tookHalf: false },
    { ev: "paper_close", mint: "m2", pnl: 20, reason: "tp" },
  ];
  const archivedPositions = [
    // Duplicate of m1 in logs
    { mint: "m1", sig: "sig1", signalId: 101, tookHalf: false },
    // Distinct older archived position
    { mint: "m3", sig: "sig3", signalId: 103, tookHalf: true, realizedBankedPct: 50 },
  ];

  const summary = analyzeLogs(rows, { archivedPositions });
  assert.equal(summary.archivedUnresolvedCount, 2); // m1 (deduplicated) + m3
  assert.equal(summary.closedCount, 1);
});
