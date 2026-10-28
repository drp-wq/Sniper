// Usage: node src/report.js   -> summary of paper results from logs/paper.jsonl
import { readFileSync, existsSync } from "node:fs";

const file = "logs/paper.jsonl";
if (!existsSync(file)) { console.log("No log yet."); process.exit(0); }

const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const gates = rows.filter((r) => r.ev === "gate");
const closed = rows.filter((r) => r.ev === "paper_close");
const pnls = closed.map((r) => r.pnl).sort((a, b) => a - b);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const median = (a) => (a.length ? a[Math.floor(a.length / 2)] : 0);

console.log(`Signals gated: ${gates.length}  passed: ${gates.filter((g) => g.pass).length}`);
const lags = gates.map((g) => g.lagMs).filter(Number.isFinite).sort((a, b) => a - b);
if (lags.length) {
  console.log(`Relay lag ms  median: ${median(lags)}  p90: ${lags[Math.floor(lags.length * 0.9)]}`);
}
console.log(`Closed trades: ${closed.length}`);
if (closed.length) {
  console.log(`Win rate: ${((pnls.filter((x) => x > 0).length / pnls.length) * 100).toFixed(1)}%`);
  console.log(`Mean pnl: ${mean(pnls).toFixed(2)}%  Median: ${median(pnls).toFixed(2)}%`);
  console.log(`Best: ${pnls.at(-1)}%  Worst: ${pnls[0]}%`);
  const by = {};
  for (const r of closed) (by[r.reason] ??= []).push(r.pnl);
  console.log("By exit reason:");
  for (const [k, v] of Object.entries(by)) {
    console.log(`  ${k.padEnd(22)} n=${v.length}  mean=${mean(v).toFixed(1)}%`);
  }
}
