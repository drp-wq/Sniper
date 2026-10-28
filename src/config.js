import { readFileSync, existsSync } from "node:fs";

// Minimal .env loader (no dependencies).
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k} (see .env.example)`);
  return v;
};
const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);

export const cfg = {
  rpcUrl: need("RPC_URL"),
  workerUrl: need("WORKER_URL").replace(/\/$/, ""),
  appKey: need("APP_KEY"),
  pollMs: num("POLL_MS", 3000),
  priceMs: num("PRICE_MS", 5000),
  heartbeatMs: 5 * 60 * 1000,
  maxOpen: num("MAX_OPEN", 5),
  minLiqUsd: num("MIN_LIQ_USD", 15000),
  // Pessimistic paper fills: you will not get the screen price.
  entrySlip: num("ENTRY_SLIP", 0.05),
  exitSlip: num("EXIT_SLIP", 0.08),
  gate: { maxTop10Pct: num("MAX_TOP10_PCT", 35) },
  // Exit rules (percent unless noted). Tune these from the iPad.
  rules: {
    stopLoss: 25,      // exit at -25% from entry
    bandDown: 10,      // time-stop band: -10% ...
    bandUp: 15,        // ... to +15% of entry
    timeStopSec: 180,  // exit if sideways in band this long with no new high
    maxHoldMin: 30,    // exit remainder after 30 min
    takeProfit: 100,   // sell half at +100%
    trailArm: 50,      // arm trailing stop at +50%
    trail: 20,         // exit on 20% drawdown from peak once armed
    liqDrop: 30,       // exit if liquidity falls 30% from entry
    noQuoteTicks: 12,  // consecutive missing quotes before counting a total loss
  },
};
