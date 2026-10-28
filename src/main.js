import { existsSync } from "node:fs";
import { cfg } from "./config.js";
import { getSignals, heartbeat, notify } from "./api.js";
import { runGate } from "./gate.js";
import { openPaper, tick, openCount, isOpen } from "./paper.js";
import { log } from "./log.js";

let since = -1;              // -1 = first poll only learns the current sequence
const seen = new Set();      // mints already handled this run

async function handle(s) {
  const lagMs = Date.now() - s.ts;   // relay delay: measure it, it is part of your real latency
  const g = await runGate(s.mint, cfg.gate);
  log("gate", { mint: s.mint, pass: g.pass, reasons: g.reasons, top10Pct: g.top10Pct, lagMs });
  if (g.pass && !isOpen(s.mint)) await openPaper(s.mint, s.sig);
}

async function pollOnce() {
  const { signals = [], seq = since, halt = false } = await getSignals(since);
  since = seq;
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

log("start", { pollMs: cfg.pollMs, paperOnly: true });
notify("Bot started (paper mode)");
pollLoop();
setInterval(() => tick().catch((e) => log("error", { where: "tick", msg: String(e) })), cfg.priceMs);
setInterval(() => heartbeat(openCount()), cfg.heartbeatMs);
heartbeat(openCount());
process.on("SIGINT", () => { log("stop", {}); process.exit(0); });
