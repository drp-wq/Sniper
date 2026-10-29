import { existsSync } from "node:fs";
import { cfg } from "./config.js";
import { getSignals, heartbeat, notify } from "./api.js";
import { runGate } from "./gate.js";
import { openPaper, tick, snapshot, isOpen } from "./paper.js";
import { readRows, computeStats } from "./stats.js";
import { log } from "./log.js";

let since = -1;              // -1 = first poll only learns the current sequence
const seen = new Set();      // mints already handled this run
const recentGates = [];      // last 10 gate results, shown in the Mini App

// Apply rule overrides set from the Mini App (server already range-checks them).
function applyRules(rules) {
  for (const k of Object.keys(cfg.rules)) {
    const v = rules?.[k];
    if (Number.isFinite(v) && v !== cfg.rules[k]) {
      log("rule_change", { key: k, from: cfg.rules[k], to: v });
      cfg.rules[k] = v;
    }
  }
}

async function handle(s) {
  const lagMs = Date.now() - s.ts;   // relay delay: measure it, it is part of your real latency
  const g = await runGate(s.mint, cfg.gate);
  log("gate", { mint: s.mint, pass: g.pass, reasons: g.reasons, top10Pct: g.top10Pct, lagMs });
  recentGates.push({ mint: s.mint, pass: g.pass, reasons: g.reasons, ts: Date.now() });
  if (recentGates.length > 10) recentGates.shift();
  if (g.pass && !isOpen(s.mint)) await openPaper(s.mint, s.sig);
}

async function pollOnce() {
  const { signals = [], seq = since, halt = false, rules } = await getSignals(since);
  since = seq;
  applyRules(rules);
  const halted = halt || existsSync("HALT");   // kill switch: remote flag or local file
  for (const s of signals) {
    if (seen.has(s.mint)) continue;
    seen.add(s.mint);
    if (halted) { log("halted_skip", { mint: s.mint }); continue; }
    handle(s).catch((e) => log("error", { where: "handle", msg: String(e) }));
  }
}

async function pollLoop() {
  try {
    await pollOnce();
  } catch (e) {
    log("error", { where: "poll", msg: String(e) });
  }
  setTimeout(pollLoop, cfg.pollMs);
}

// Snapshot for the Mini App + watchdog. Written every 3 min (KV free tier has a daily write cap).
function sendHeartbeat() {
  try {
    heartbeat({ open: snapshot(), stats: computeStats(readRows()), gates: recentGates, rules: cfg.rules });
  } catch (e) {
    log("error", { where: "heartbeat", msg: String(e) });
  }
}

log("start", { pollMs: cfg.pollMs, paperOnly: true });
notify("Bot started (paper mode)");
pollLoop();
setInterval(() => tick().catch((e) => log("error", { where: "tick", msg: String(e) })), cfg.priceMs);
setInterval(sendHeartbeat, cfg.heartbeatMs);
sendHeartbeat();
process.on("SIGINT", () => { log("stop", {}); process.exit(0); });
