import { readFileSync, existsSync } from "node:fs";

export function readRows(file = "logs/paper.jsonl") {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const median = (a) => (a.length ? a[Math.floor(a.length / 2)] : 0);

// Pure summary of paper results; used by report.js and the Mini App heartbeat.
export function computeStats(rows) {
  const gates = rows.filter((r) => r.ev === "gate");
  const closed = rows.filter((r) => r.ev === "paper_close");
  const pnls = closed.map((r) => r.pnl).sort((a, b) => a - b);
  const lags = gates.map((g) => g.lagMs).filter(Number.isFinite).sort((a, b) => a - b);
  const by = {};
  for (const r of closed) (by[r.reason] ??= []).push(r.pnl);
  const byReason = {};
  for (const [k, v] of Object.entries(by)) byReason[k] = { n: v.length, mean: Number(mean(v).toFixed(1)) };
  return {
    gated: gates.length,
    passed: gates.filter((g) => g.pass).length,
    closed: closed.length,
    winRate: pnls.length ? (pnls.filter((x) => x > 0).length / pnls.length) * 100 : 0,
    mean: Number(mean(pnls).toFixed(2)),
    median: Number(median(pnls).toFixed(2)),
    best: pnls.length ? pnls.at(-1) : null,
    worst: pnls.length ? pnls[0] : null,
    lagMedian: lags.length ? median(lags) : null,
    lagP90: lags.length ? lags[Math.floor(lags.length * 0.9)] : null,
    byReason,
  };
}

export function computeDailyPnl(rows, targetDate = new Date()) {
  const targetIso = (targetDate instanceof Date ? targetDate : new Date(targetDate)).toISOString().slice(0, 10);
  return Number(
    rows
      .filter((r) => r.ev === "paper_close" && typeof r.ts === "string" && r.ts.startsWith(targetIso))
      .reduce((acc, r) => acc + (Number(r.pnl) || 0), 0)
      .toFixed(2)
  );
}
