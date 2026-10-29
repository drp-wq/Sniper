#!/usr/bin/env node

import { writeFileSync, mkdirSync } from "node:fs";
import worker from "../worker/index.js";
import { runGate } from "../src/gate.js";
import { openPaper, tick, snapshot, resetPositions } from "../src/paper.js";
import { readRows, computeStats } from "../src/stats.js";
import { log } from "../src/log.js";

// Ensure logs directory exists
mkdirSync("logs", { recursive: true });
const LOG_FILE = "logs/paper.jsonl";

// Reset log file for fresh simulation run
writeFileSync(LOG_FILE, "");
resetPositions();

console.log("=================================================");
console.log("  SNIPER-BOT LOCAL ZERO-NETWORK SIMULATION");
console.log("=================================================\n");

// 1. In-memory Mock Worker KV
class MockKV {
  constructor() {
    this.map = new Map();
  }
  async get(key, type = "text") {
    const val = this.map.get(key);
    if (val === undefined) return null;
    if (type === "json") {
      try { return JSON.parse(val); } catch { return null; }
    }
    return val;
  }
  async put(key, value) {
    this.map.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  async delete(key) {
    this.map.delete(key);
  }
}

const kv = new MockKV();
const workerEnv = {
  KV: kv,
  HELIUS_AUTH: "sim-helius-secret",
  APP_KEY: "sim-app-key",
};

// 2. Feed simulated Solana transactions to Worker /hook
const simulatedMints = [
  { mint: "Mint_Runner_TP_Trail", desc: "Surges +120%, takes half, trailing stop remainder" },
  { mint: "Mint_Dump_StopLoss", desc: "Dumps -30%, triggers stop-loss at -25%" },
  { mint: "Mint_Rug_LiqDrop", desc: "Liquidity removed, triggers liquidity drop" },
  { mint: "Mint_Sideways_TimeStop", desc: "Flat sideways price action, triggers time-stop at 180s" },
];

console.log("1. Dispatching synthetic Helius webhook to Worker...");
const webhookBody = simulatedMints.map((m, idx) => ({
  signature: `sig_${idx + 1}`,
  tokenTransfers: [{ mint: m.mint }],
}));

const hookReq = new Request("https://worker.dev/hook", {
  method: "POST",
  headers: {
    authorization: "sim-helius-secret",
    "content-type": "application/json",
  },
  body: JSON.stringify(webhookBody),
});

const hookRes = await worker.fetch(hookReq, workerEnv);
if (hookRes.status !== 200) {
  throw new Error(`Worker webhook failed with HTTP ${hookRes.status}`);
}
console.log(`   Queued ${simulatedMints.length} token mints into Worker KV.\n`);

// 3. Phone polls /signals from Worker
console.log("2. Phone polls /signals (simulated)...");
const pollReq = new Request("https://worker.dev/signals?since=0", {
  headers: { "x-key": "sim-app-key" },
});
const pollData = await (await worker.fetch(pollReq, workerEnv)).json();
console.log(`   Received ${pollData.signals.length} signals (halt: ${pollData.halt}).\n`);

// 4. Mock Solana JSON-RPC for Gate Check
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const mockRpc = async (method, params) => {
  if (method === "getAccountInfo") {
    return {
      value: {
        data: {
          parsed: {
            info: {
              mintAuthority: null,
              freezeAuthority: null,
              decimals: 9,
            },
          },
        },
      },
    };
  }
  if (method === "getTokenSupply") return { value: { uiAmount: 1000000 } };
  if (method === "getTokenLargestAccounts") {
    return {
      value: [
        { address: "AccPool", uiAmount: 850000 },
        { address: "AccHolder1", uiAmount: 100000 },
        { address: "AccHolder2", uiAmount: 50000 },
      ],
    };
  }
  if (method === "getMultipleAccounts") {
    const keys = params[0];
    if (keys.includes("AccPool")) {
      return {
        value: [
          { data: { parsed: { info: { owner: "RaydiumPoolPDA" } } } },
          { data: { parsed: { info: { owner: "Wallet1" } } } },
          { data: { parsed: { info: { owner: "Wallet2" } } } },
        ],
      };
    }
    return {
      value: [
        { owner: "RaydiumProtocol111111111111111111111111" },
        { owner: SYSTEM_PROGRAM },
        { owner: SYSTEM_PROGRAM },
      ],
    };
  }
  return { value: [] };
};

// Gate check for all signals
console.log("3. Running safety gate RPC checks on signals...");
const passedSignals = [];
for (const s of pollData.signals) {
  const g = await runGate(s.mint, { maxTop10Pct: 35 }, mockRpc);
  log("gate", { mint: s.mint, pass: g.pass, reasons: g.reasons, top10Pct: g.top10Pct, lagMs: 145 });
  console.log(`   Gate [${s.mint.slice(0, 22)}...]: ${g.pass ? "PASS" : "FAIL"} (top10: ${g.top10Pct}%)`);
  if (g.pass) passedSignals.push(s);
}
console.log(`   ${passedSignals.length}/${pollData.signals.length} passed gate.\n`);

// 5. Open Paper Positions
console.log("4. Opening simulated paper positions...");
const priceState = new Map();

// Initial price table
priceState.set("Mint_Runner_TP_Trail", { price: 1.00, liqUsd: 50000 });
priceState.set("Mint_Dump_StopLoss", { price: 1.00, liqUsd: 50000 });
priceState.set("Mint_Rug_LiqDrop", { price: 1.00, liqUsd: 50000 });
priceState.set("Mint_Sideways_TimeStop", { price: 1.00, liqUsd: 50000 });

const getSimQuote = async (mint) => {
  const st = priceState.get(mint);
  if (!st) return null;
  return { price: st.price, liqUsd: st.liqUsd, pair: `pair_${mint}` };
};

let simTime = Date.now();
for (const s of passedSignals) {
  await openPaper(s.mint, s.sig, {
    getQuote: getSimQuote,
    now: () => simTime,
    retryDelayMs: 0,
  });
}
console.log(`   Active open positions: ${snapshot().length}\n`);

// 6. Simulate price movement steps
console.log("5. Simulating price feeds and position evaluation ticks...");

// Tick 1: Runner pumps to +120% (triggers take-profit half at +100%)
console.log("   --- Step 1 (+10s): Mint_Runner pumps to $2.20 ---");
simTime += 10000;
priceState.set("Mint_Runner_TP_Trail", { price: 2.20, liqUsd: 65000 });
await tick({ getQuote: getSimQuote, now: () => simTime });

// Tick 2: Runner rises to peak $2.40, then pulls back to $1.90 (triggers trailing stop)
console.log("   --- Step 2 (+20s): Mint_Runner peaks at $2.40, pulls back to $1.90 (trailing stop) ---");
simTime += 10000;
priceState.set("Mint_Runner_TP_Trail", { price: 2.40, liqUsd: 70000 });
await tick({ getQuote: getSimQuote, now: () => simTime });

simTime += 10000;
priceState.set("Mint_Runner_TP_Trail", { price: 1.90, liqUsd: 60000 });
await tick({ getQuote: getSimQuote, now: () => simTime });

// Tick 3: Dump token drops to $0.75 (triggers stop loss)
console.log("   --- Step 3 (+30s): Mint_Dump drops to $0.75 (stop-loss) ---");
simTime += 10000;
priceState.set("Mint_Dump_StopLoss", { price: 0.75, liqUsd: 40000 });
await tick({ getQuote: getSimQuote, now: () => simTime });

// Tick 4: Rug token drops liquidity from $50k to $15k (triggers liquidity drop)
console.log("   --- Step 4 (+40s): Mint_Rug liquidity plummets to $15k (liquidity-drop) ---");
simTime += 10000;
priceState.set("Mint_Rug_LiqDrop", { price: 0.95, liqUsd: 15000 });
await tick({ getQuote: getSimQuote, now: () => simTime });

// Tick 5: Sideways token sits flat until 185 seconds elapse (triggers time stop)
console.log("   --- Step 5 (+185s): Mint_Sideways stays in band for >180s (time-stop) ---");
simTime += 185000;
await tick({ getQuote: getSimQuote, now: () => simTime });

console.log("\n=================================================");
console.log("  SIMULATION RESULTS & PERFORMANCE REPORT");
console.log("=================================================");

const rows = readRows(LOG_FILE);
const stats = computeStats(rows);

console.log(`Signals gated: ${stats.gated}  passed: ${stats.passed}`);
if (stats.lagMedian !== null) {
  console.log(`Relay lag ms   median: ${stats.lagMedian}  p90: ${stats.lagP90}`);
}
console.log(`Closed trades: ${stats.closed}`);
if (stats.closed > 0) {
  console.log(`Win rate:      ${stats.winRate.toFixed(1)}%`);
  console.log(`Mean PnL:      ${stats.mean}%  Median: ${stats.median}%`);
  console.log(`Best PnL:      +${stats.best}%  Worst: ${stats.worst}%`);
  console.log("\nBy exit reason:");
  for (const [reason, item] of Object.entries(stats.byReason)) {
    const formattedMean = (item.mean > 0 ? "+" : "") + item.mean.toFixed(1) + "%";
    console.log(`  ${reason.padEnd(20)} n=${item.n}  mean=${formattedMean}`);
  }
}
console.log("=================================================\n");
console.log("Simulation complete. Full log saved to logs/paper.jsonl.");
