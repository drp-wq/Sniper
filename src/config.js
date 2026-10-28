import { readFileSync, existsSync } from "node:fs";

// Minimal .env loader (no dependencies).
export function parseEnvText(text, targetEnv = {}) {
  for (const line of String(text).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in targetEnv)) {
      targetEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return targetEnv;
}

if (existsSync(".env")) {
  parseEnvText(readFileSync(".env", "utf8"), process.env);
}

export function parseNum(env, key, defaultVal, { min = -Infinity, max = Infinity } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultVal;
  const val = Number(raw);
  if (!Number.isFinite(val) || val < min || val > max) {
    throw new Error(`Invalid numeric env var ${key}="${raw}" (expected finite number in [${min}, ${max}])`);
  }
  return val;
}

export function loadConfig(env = process.env, { allowPlaceholder = false } = {}) {
  const need = (k, fallback = "") => {
    const v = env[k] !== undefined ? String(env[k]).trim() : "";
    if (!v) {
      if (allowPlaceholder) return fallback;
      throw new Error(`Missing env var ${k} (see .env.example)`);
    }
    return v;
  };

  return {
    rpcUrl: need("RPC_URL", "http://127.0.0.1:8899"),
    workerUrl: need("WORKER_URL", "http://127.0.0.1:8787").replace(/\/$/, ""),
    appKey: need("APP_KEY", "test-app-key"),
    pollMs: parseNum(env, "POLL_MS", 3000, { min: 250, max: 300000 }),
    priceMs: parseNum(env, "PRICE_MS", 5000, { min: 500, max: 300000 }),
    heartbeatMs: parseNum(env, "HEARTBEAT_MS", 5 * 60 * 1000, { min: 5000, max: 3600000 }),
    maxSignalAgeMs: parseNum(env, "MAX_SIGNAL_AGE_MS", 60000, { min: 1000, max: 3600000 }),
    maxOpen: Math.floor(parseNum(env, "MAX_OPEN", 5, { min: 1, max: 100 })),
    minLiqUsd: parseNum(env, "MIN_LIQ_USD", 15000, { min: 0, max: 1e9 }),
    // Pessimistic paper fills: you will not get the screen price.
    entrySlip: parseNum(env, "ENTRY_SLIP", 0.05, { min: 0, max: 0.95 }),
    exitSlip: parseNum(env, "EXIT_SLIP", 0.08, { min: 0, max: 0.95 }),
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
      noQuoteTicks: 12,  // consecutive missing quotes before counting a total loss
    },
  };
}

const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.env.NODE_TEST_CONTEXT !== undefined ||
  process.execArgv.some((arg) => arg.startsWith("--test"));
export const cfg = loadConfig(process.env, { allowPlaceholder: isTestEnv });
