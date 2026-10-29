import { appendFileSync, mkdirSync } from "node:fs";

mkdirSync("logs", { recursive: true });

// One JSON object per line; read later with src/report.js.
export function log(ev, data = {}) {
  const row = { ts: new Date().toISOString(), ev, ...data };
  console.log(JSON.stringify(row));
  try {
    appendFileSync("logs/paper.jsonl", JSON.stringify(row) + "\n");
  } catch {
    /* never crash on logging */
  }
}
