import { existsSync } from "node:fs";
import { cfg } from "./config.js";
import { getSignals, heartbeat, notify } from "./api.js";
import { RiskGuardian } from "./guardian.js";
import { runGate } from "./gate.js";
import { openPaper, tick, snapshot, isOpen, getDailyRealizedPnl, setDailyRealizedPnl, loadPositions } from "./paper.js";
import { readRows, computeStats, computeDailyPnl } from "./stats.js";
import { log } from "./log.js";

let since = -1;              // -1 = first poll only learns the current sequence
const seen = new Set();      // mints already handled this run
const recentGates = [];      // last 10 gate results, shown in the Mini App
let pollFailures = 0;

// Recover persisted open positions and daily realized PnL on startup for 24h continuity
const loadedPositionsCount = loadPositions();
const initialDailyLoss = computeDailyPnl(readRows());
setDailyRealizedPnl(initialDailyLoss);

// Apply rule overrides set from the Mini App (server already range-checks them).
function applyRules(rules) {
  for (const k of Object.keys(cfg.rules)) {
    const v = rules?.[k];
    if (Number.isFinite(v) && v !== cfg.rules[k]) {
      log("rule_change", { key: k, from: cfg.rules[k], to: v });
      notify(`⚙️ RULE CHANGE\n${k}: ${cfg.rules[k]} ➔ ${v}`);
      cfg.rules[k] = v;
    }
  }
}

async function handle(s) {
  const lagMs = Date.now() - s.ts;   // relay delay: measure it, it is part of your real latency
  notify(`📡 LIVE SIGNAL\nMint: ${s.mint}\nRelay Latency: ${lagMs}ms`);

  const g = await runGate(s.mint, cfg.gate);
  log("gate", { mint: s.mint, pass: g.pass, reasons: g.reasons, top10Pct: g.top10Pct, lagMs });
  recentGates.push({ mint: s.mint, pass: g.pass, reasons: g.reasons, ts: Date.now() });
  if (recentGates.length > 10) recentGates.shift();

  if (g.pass) {
    notify(`🛡️ GATE PASSED\nMint: ${s.mint}\nTop 10 Wallets: ${g.top10Pct}%\nAuthorities: Revoked & Clean`);
    if (!isOpen(s.mint)) await openPaper(s.mint, s.sig);
  } else {
    notify(`🚫 GATE REJECTED\nMint: ${s.mint}\nReasons:\n${g.reasons.map((r) => `• ${r}`).join("\n")}`);
  }
}

async function pollOnce() {
  const { signals = [], seq = since, halt = false, rules } = await getSignals(since);
  since = seq;
  applyRules(rules);
  const halted = halt || existsSync("HALT");   // kill switch: remote flag or local file
  for (const s of signals) {
    if (seen.has(s.mint)) continue;
    seen.add(s.mint);
    const verdict = RiskGuardian.evaluate(s, { halt: halted });
    if (!verdict.allow) {
      log("guardian_skip", { mint: s.mint, reason: verdict.reason, explanation: verdict.explanation });
      notify(`⚠️ RISK GUARDIAN VETO\nMint: ${s.mint}\nReason: ${verdict.reason}\n${verdict.explanation}`);
      continue;
    }
    handle(s).catch((e) => log("error", { where: "handle", msg: String(e) }));
  }
}

async function pollLoop() {
  let nextDelay = cfg.pollMs;
  try {
    await pollOnce();
    pollFailures = 0;
  } catch (e) {
    pollFailures++;
    // Exponential backoff capped at 30 seconds on persistent network/relay outages
    nextDelay = Math.min(30000, cfg.pollMs * Math.pow(1.5, Math.min(pollFailures, 8)));
    log("error", { where: "poll", msg: String(e), backoffMs: nextDelay });
  }
  setTimeout(pollLoop, nextDelay);
}

// Snapshot for the Mini App + watchdog. Written every 3 min (KV free tier has a daily write cap).
function sendHeartbeat() {
  try {
    heartbeat({
      open: snapshot(),
      stats: computeStats(readRows()),
      gates: recentGates,
      rules: cfg.rules,
      dailyLoss: getDailyRealizedPnl(),
      halted: existsSync("HALT"),
    });
  } catch (e) {
    log("error", { where: "heartbeat", msg: String(e) });
  }
}

log("start", { pollMs: cfg.pollMs, paperOnly: true, recoveredPositions: loadedPositionsCount, dailyLoss: initialDailyLoss });
notify(`Bot started (paper mode | recovered ${loadedPositionsCount} open positions)`);
pollLoop();
setInterval(() => tick().catch((e) => log("error", { where: "tick", msg: String(e) })), cfg.priceMs);
setInterval(sendHeartbeat, cfg.heartbeatMs);
sendHeartbeat();

// Resilient process lifecycle guards for 24-hour continuous runtime
process.on("unhandledRejection", (err) => {
  log("unhandled_rejection", { msg: String(err?.message || err) });
});

process.on("uncaughtException", (err) => {
  log("uncaught_exception", { msg: String(err?.message || err) });
});

process.on("SIGTERM", () => {
  log("stop", { signal: "SIGTERM" });
  process.exit(0);
});

process.on("SIGINT", () => {
  log("stop", { signal: "SIGINT" });
  process.exit(0);
});
