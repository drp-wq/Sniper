// Usage: node src/report.js   -> summary of paper results from logs/paper.jsonl
import { readRows, computeStats } from "./stats.js";

const rows = readRows();
if (!rows.length) { console.log("No log yet."); process.exit(0); }
const s = computeStats(rows);

console.log(`Signals gated: ${s.gated}  passed: ${s.passed}`);
if (s.lagMedian !== null) console.log(`Relay lag ms  median: ${s.lagMedian}  p90: ${s.lagP90}`);
console.log(`Closed trades: ${s.closed}`);
if (s.closed) {
  console.log(`Win rate: ${s.winRate.toFixed(1)}%`);
  console.log(`Mean pnl: ${s.mean}%  Median: ${s.median}%`);
  console.log(`Best: ${s.best}%  Worst: ${s.worst}%`);
  console.log("By exit reason:");
  for (const [k, v] of Object.entries(s.byReason)) {
    console.log(`  ${k.padEnd(22)} n=${v.n}  mean=${v.mean}%`);
  }
}
