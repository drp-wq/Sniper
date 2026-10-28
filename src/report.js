// Usage: node src/report.js   -> summary of paper results from logs/paper.jsonl
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { computeDoubleSlipPnl } from "./paper.js";

export const sum = (a) => a.reduce((s, x) => s + x, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : 0);

// Exact median: averages the two middle elements for even-sized arrays.
export function median(a) {
  if (!a.length) return 0;
  const sorted = [...a].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(a, p) {
  if (!a.length) return 0;
  const sorted = [...a].sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// Equity-curve maximum drawdown using fixed-fractional stake per trade (default 10% of equity per trade)
// and cumulative percentage-point drawdown (sum of trade PnL %).
export function computeDrawdown(pnlList, stakeFraction = 0.1) {
  let cumPct = 0;
  let peakCumPct = 0;
  let maxDdPctPoints = 0;

  let equity = 100;
  let peakEquity = 100;
  let maxDdEquityPct = 0;

  for (const rawPnl of pnlList) {
    const pnl = Number(rawPnl);
    if (!Number.isFinite(pnl)) continue;

    cumPct += pnl;
    if (cumPct > peakCumPct) peakCumPct = cumPct;
    const ddPoints = peakCumPct - cumPct;
    if (ddPoints > maxDdPctPoints) maxDdPctPoints = ddPoints;

    const tradeReturn = (pnl / 100) * stakeFraction;
    equity = Math.max(0, equity * (1 + tradeReturn));
    if (equity > peakEquity) peakEquity = equity;
    const ddEq = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (ddEq > maxDdEquityPct) maxDdEquityPct = ddEq;
  }

  return {
    maxDdPctPoints: Number(maxDdPctPoints.toFixed(2)),
    maxDdEquityPct: Number(maxDdEquityPct.toFixed(2)),
    endingEquityIndex: Number(equity.toFixed(2)),
  };
}

// Estimate 2x slippage PnL when reading legacy paper_close records that lack pnl2xSlip.
export function estimateLegacy2xSlipPnl(row, entrySlip = cfg.entrySlip, exitSlip = cfg.exitSlip) {
  if (Number.isFinite(Number(row?.pnl2xSlip))) return Number(row.pnl2xSlip);
  if (Number.isFinite(Number(row?.rawEntryQuote)) && Number.isFinite(Number(row?.rawExitQuote))) {
    const exact = computeDoubleSlipPnl({
      rawEntryQuote: Number(row.rawEntryQuote),
      rawExitQuote: Number(row.rawExitQuote),
      entrySlip,
      exitSlip,
    });
    if (exact !== null) return exact;
  }
  const pnl = Number(row?.pnl);
  if (!Number.isFinite(pnl)) return null;
  // Conservative multiplicative adjustment from 1x (entrySlip, exitSlip) to 2x (2*entrySlip, 2*exitSlip)
  const grossRatio = (1 + pnl / 100) * ((1 + entrySlip) / Math.max(0.01, 1 - exitSlip));
  const netRatio2x = grossRatio * (Math.max(0.01, 1 - 2 * exitSlip) / (1 + 2 * entrySlip));
  return Number(((netRatio2x - 1) * 100).toFixed(2));
}

export function parseJsonlText(text) {
  const rows = [];
  let malformedLines = 0;
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      malformedLines += 1;
    }
  }
  return { rows, malformedLines };
}

export function analyzeLogs(rows, { malformedLines = 0, activePositions = [], archivedPositions = [] } = {}) {
  const gates = rows.filter((r) => r && r.ev === "gate");
  const gateErrors = rows.filter((r) => r && r.ev === "gate_error");
  const gaps = rows.filter((r) => r && r.ev === "signal_gap");
  const skips = rows.filter((r) => r && (r.ev === "signal_skip" || r.ev === "halted_skip" || String(r.ev).startsWith("skip_")));
  const opened = rows.filter((r) => r && r.ev === "paper_open");
  const closed = rows.filter((r) => r && r.ev === "paper_close" && Number.isFinite(Number(r.pnl)));
  const unresolvedEvents = rows.filter((r) => r && r.ev === "paper_unresolved");
  const recoveredEvents = rows.filter((r) => r && r.ev === "paper_quote_recovered");
  const archivedEvents = rows.filter((r) => r && r.ev === "paper_archived_unresolved");

  const lags = gates
    .map((g) => Number(g.lagMs ?? g.receivedAgeMs))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);

  const chronPnls = closed.map((r) => Number(r.pnl));
  const sortedPnls = [...chronPnls].sort((a, b) => a - b);
  const pnls2x = closed
    .map((r) => estimateLegacy2xSlipPnl(r))
    .filter((x) => Number.isFinite(x));

  const byReason = {};
  for (const r of closed) {
    const key = r.reason ?? "unknown";
    (byReason[key] ??= []).push(Number(r.pnl));
  }

  const bySkipReason = {};
  for (const r of skips) {
    const key = r.reason ?? r.ev;
    bySkipReason[key] = (bySkipReason[key] ?? 0) + 1;
  }

  // Reconstruct unclosed positions from log history if activePositions not supplied
  const openMap = new Map();
  for (const r of rows) {
    if (!r || !r.mint) continue;
    if (r.ev === "paper_open") openMap.set(r.mint, r);
    if (r.ev === "paper_close" || r.ev === "paper_archived_unresolved") openMap.delete(r.mint);
  }
  const unresolvedActive = activePositions.length
    ? activePositions
    : [...openMap.values()];

  const archivedMap = new Map();
  for (const a of archivedPositions) {
    if (!a) continue;
    const key = `${a.signalId ?? ""}:${a.sig ?? ""}:${a.mint ?? ""}`;
    archivedMap.set(key, a);
  }
  for (const a of archivedEvents) {
    if (!a) continue;
    const key = `${a.signalId ?? ""}:${a.sig ?? ""}:${a.mint ?? ""}`;
    archivedMap.set(key, a);
  }
  const archivedList = [...archivedMap.values()];
  const archivedUnresolvedCount = archivedList.length;

  // Separate worst-case stress estimate if archived unresolved positions lost 100% of their remaining unclosed weight
  const stressedArchPnls = archivedList.map((a) => {
    const banked = Number.isFinite(Number(a?.realizedBankedPct ?? a?.realized))
      ? Number(a.realizedBankedPct ?? a.realized)
      : 0;
    const remWeight = a?.tookHalf ? 0.5 : 1.0;
    return Number((banked + remWeight * -100).toFixed(2));
  });
  const combinedStressedPnls = [...chronPnls, ...stressedArchPnls];
  const stressedMeanPnl = combinedStressedPnls.length
    ? Number(mean(combinedStressedPnls).toFixed(2))
    : null;
  const stressedMedianPnl = combinedStressedPnls.length
    ? Number(median(combinedStressedPnls).toFixed(2))
    : null;

  const totalCompletedOrArchived = closed.length + archivedUnresolvedCount;
  const archivedSharePct =
    totalCompletedOrArchived > 0
      ? Number(((archivedUnresolvedCount / totalCompletedOrArchived) * 100).toFixed(1))
      : 0;
  const archivedBiasWarning = archivedSharePct > 5;

  const dd = computeDrawdown(chronPnls, 0.1);
  const meanPnl = Number(mean(sortedPnls).toFixed(2));
  const medianPnl = Number(median(sortedPnls).toFixed(2));
  const meanPnl2x = Number(mean(pnls2x).toFixed(2));
  const medianPnl2x = Number(median(pnls2x).toFixed(2));

  const minTradesTarget = 200;
  // Archived positions are strictly excluded from the 200-closed-trade target
  const sampleAdequate = closed.length >= minTradesTarget;
  const passesEvalGate =
    sampleAdequate &&
    meanPnl > 0 &&
    medianPnl > 0 &&
    meanPnl2x > 0 &&
    medianPnl2x > 0;

  return {
    malformedLines,
    signalsGated: gates.length,
    signalsPassed: gates.filter((g) => g.pass).length,
    gateErrors: gateErrors.length,
    signalGaps: gaps.length,
    missingSequenceTotal: sum(gaps.map((g) => Number(g.missingSequenceCount ?? 0)).filter(Number.isFinite)),
    lagMedianMs: lags.length ? Number(median(lags).toFixed(1)) : null,
    lagP90Ms: lags.length ? Number(percentile(lags, 90).toFixed(1)) : null,
    openedCount: opened.length,
    closedCount: closed.length,
    unresolvedOpenCount: unresolvedActive.length,
    unresolvedMissingQuoteEvents: unresolvedEvents.length,
    quoteRecoveredEvents: recoveredEvents.length,
    archivedUnresolvedCount,
    archivedSharePct,
    archivedBiasWarning,
    stressedMeanPnl,
    stressedMedianPnl,
    winRatePct: sortedPnls.length
      ? Number(((sortedPnls.filter((x) => x > 0).length / sortedPnls.length) * 100).toFixed(1))
      : 0,
    meanPnl,
    medianPnl,
    bestPnl: sortedPnls.length ? sortedPnls.at(-1) : 0,
    worstPnl: sortedPnls.length ? sortedPnls[0] : 0,
    meanPnl2x,
    medianPnl2x,
    drawdown: dd,
    byReason,
    bySkipReason,
    evaluationGate: {
      minTradesTarget,
      sampleAdequate,
      passesEvalGate,
      archivedBiasWarning,
    },
  };
}

export function formatReport(summary) {
  const lines = [];
  lines.push(
    `Signals gated: ${summary.signalsGated}  passed: ${summary.signalsPassed}  gate_errors: ${summary.gateErrors}`,
  );
  if (summary.signalGaps > 0) {
    lines.push(`Queue gaps detected: ${summary.signalGaps} (missed seq IDs: ${summary.missingSequenceTotal})`);
  }
  if (summary.lagMedianMs !== null) {
    lines.push(
      `Relay lag ms (Worker receipt -> phone gate)  median: ${summary.lagMedianMs}  p90: ${summary.lagP90Ms}`,
    );
  }
  lines.push(
    `Positions opened: ${summary.openedCount}  Closed trades: ${summary.closedCount}  Unresolved/open: ${summary.unresolvedOpenCount}  Archived unresolved: ${summary.archivedUnresolvedCount}`,
  );
  if (summary.unresolvedMissingQuoteEvents > 0 || summary.quoteRecoveredEvents > 0 || summary.archivedUnresolvedCount > 0) {
    lines.push(
      `Missing-quote events -> unresolved: ${summary.unresolvedMissingQuoteEvents}  recovered: ${summary.quoteRecoveredEvents}  archived: ${summary.archivedUnresolvedCount} (${summary.archivedSharePct}% of completed/archived)`,
    );
  }
  if (summary.archivedUnresolvedCount > 0 && summary.stressedMeanPnl !== null) {
    lines.push(
      `Worst-case unresolved stress estimate (if archived lost remaining weight): Mean ${summary.stressedMeanPnl.toFixed(2)}%  Median ${summary.stressedMedianPnl.toFixed(2)}%`,
    );
  }
  if (summary.archivedBiasWarning) {
    lines.push(
      `Bias warning: archived unresolved positions exceed 5% (${summary.archivedSharePct}%) of completed/archived outcomes.`,
    );
  }
  if (summary.malformedLines > 0) {
    lines.push(`Warning: ignored ${summary.malformedLines} malformed JSONL line(s)`);
  }

  if (summary.closedCount > 0) {
    lines.push(`Win rate: ${summary.winRatePct.toFixed(1)}%`);
    lines.push(`Mean pnl: ${summary.meanPnl.toFixed(2)}%  Median: ${summary.medianPnl.toFixed(2)}%`);
    lines.push(
      `2x Slippage sensitivity -> Mean pnl: ${summary.meanPnl2x.toFixed(2)}%  Median: ${summary.medianPnl2x.toFixed(2)}%`,
    );
    lines.push(`Best: ${summary.bestPnl}%  Worst: ${summary.worstPnl}%`);
    lines.push(
      `Max drawdown: ${summary.drawdown.maxDdPctPoints.toFixed(2)} pct-pts (10%-stake equity DD: ${summary.drawdown.maxDdEquityPct.toFixed(2)}%, ending index: ${summary.drawdown.endingEquityIndex})`,
    );
    lines.push("By exit reason:");
    for (const [k, v] of Object.entries(summary.byReason)) {
      lines.push(
        `  ${k.padEnd(22)} n=${v.length}  mean=${mean(v).toFixed(1)}%  median=${median(v).toFixed(1)}%`,
      );
    }
  }

  const evalStatus = summary.evaluationGate.passesEvalGate
    ? "PASS (eligible for next-stage discussion; paper-only remains enforced)"
    : `INCOMPLETE/FAIL (closed=${summary.closedCount}/${summary.evaluationGate.minTradesTarget}, mean2x=${summary.meanPnl2x.toFixed(2)}%, median2x=${summary.medianPnl2x.toFixed(2)}%)`;
  lines.push(`Evaluation gate (>=200 trades & positive 1x/2x mean+median): ${evalStatus}`);

  return lines.join("\n");
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const file = process.argv[2] || "logs/paper.jsonl";
  if (!existsSync(file)) {
    console.log("No log yet.");
    process.exit(0);
  }
  const { rows, malformedLines } = parseJsonlText(readFileSync(file, "utf8"));
  let activePositions = [];
  let archivedPositions = [];
  if (existsSync("logs/positions.json")) {
    try {
      const parsed = JSON.parse(readFileSync("logs/positions.json", "utf8"));
      if (Array.isArray(parsed?.positions)) activePositions = parsed.positions;
      if (Array.isArray(parsed?.archivedUnresolved)) archivedPositions = parsed.archivedUnresolved;
    } catch {
      /* ignore corrupt positions file in report */
    }
  }
  const summary = analyzeLogs(rows, { malformedLines, activePositions, archivedPositions });
  console.log(formatReport(summary));
}
