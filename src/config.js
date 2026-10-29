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

<<<<<<< HEAD
export const cfg = {
  rpcUrl: need("RPC_URL"),
  workerUrl: need("WORKER_URL").replace(/\/$/, ""),
  appKey: need("APP_KEY"),
  pollMs: num("POLL_MS", 3000),
  priceMs: num("PRICE_MS", 5000),
  heartbeatMs: 3 * 60 * 1000,
  maxOpen: num("MAX_OPEN", 5),
  minLiqUsd: num("MIN_LIQ_USD", 15000),
  // Pessimistic paper fills: you will not get the screen price.
  entrySlip: num("ENTRY_SLIP", 0.05),
  exitSlip: num("EXIT_SLIP", 0.08),
  gate: { maxTop10Pct: num("MAX_TOP10_PCT", 35) },
  // Exit rules (percent unless noted). Tune these from the iPad.
  rules: {
    stopLoss: 25,      // exit at -25% from entry
    bandDown: 15,      // time-stop band: -15% (covers slippage) ...
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
=======
  return {
    rpcUrl: need("RPC_URL", "http://127.0.0.1:8899"),
    workerUrl: need("WORKER_URL", "http://127.0.0.1:8787").replace(/\/$/, ""),
    appKey: need("APP_KEY", "test-app-key"),
    tgToken: env.TG_TOKEN ? String(env.TG_TOKEN).trim() : "",
    tgChat: env.TG_CHAT ? String(env.TG_CHAT).trim() : "",
    pollMs: parseNum(env, "POLL_MS", 3000, { min: 250, max: 300000 }),
    priceMs: parseNum(env, "PRICE_MS", 5000, { min: 500, max: 300000 }),
    heartbeatMs: parseNum(env, "HEARTBEAT_MS", 5 * 60 * 1000, { min: 5000, max: 3600000 }),
    maxSignalAgeMs: parseNum(env, "MAX_SIGNAL_AGE_MS", 60000, { min: 1000, max: 3600000 }),
    maxOpen: Math.floor(parseNum(env, "MAX_OPEN", 5, { min: 1, max: 100 })),
    minLiqUsd: parseNum(env, "MIN_LIQ_USD", 15000, { min: 0, max: 1e9 }),
    // Pessimistic paper fills: you will not get the screen price.
    entrySlip: parseNum(env, "ENTRY_SLIP", 0.05, { min: 0, max: 0.95 }),
    exitSlip: parseNum(env, "EXIT_SLIP", 0.08, { min: 0, max: 0.95 }),
    entryQuoteRetries: Math.floor(parseNum(env, "ENTRY_QUOTE_RETRIES", 2, { min: 0, max: 5 })),
    entryQuoteRetryMs: parseNum(env, "ENTRY_QUOTE_RETRY_MS", 3000, { min: 100, max: 30000 }),
    rpcRetries: Math.floor(parseNum(env, "RPC_RETRIES", 2, { min: 0, max: 5 })),
    rpcRetryMs: parseNum(env, "RPC_RETRY_MS", 500, { min: 10, max: 10000 }),
    gate: {
      maxTop10Pct: parseNum(env, "MAX_TOP10_PCT", 35, { min: 0.1, max: 100 }),
    },
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
      noQuoteTicks: 12,  // consecutive missing quotes before marking unresolved
      maxUnresolvedMin: parseNum(env, "MAX_UNRESOLVED_MIN", 30, { min: 1, max: 1440 }),
    },
  };
}

const isCliHelper = Boolean(
  process.argv[1] &&
    (process.argv[1].endsWith("report.js") ||
      process.argv[1].endsWith("verify-telegram.js")),
);
const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.env.NODE_TEST_CONTEXT !== undefined ||
  process.execArgv.some((arg) => arg.startsWith("--test")) ||
  isCliHelper;
export const cfg = loadConfig(process.env, { allowPlaceholder: isTestEnv });
>>>>>>> 48de9de (wip)
