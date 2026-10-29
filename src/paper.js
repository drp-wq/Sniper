import { cfg } from "./config.js";
import { getQuote } from "./price.js";
import { log } from "./log.js";
import { notify } from "./api.js";

const R = cfg.rules;
const positions = new Map(); // mint -> position
let dailyRealizedPnl = 0;

export const openCount = () => positions.size;
export const isOpen = (mint) => positions.has(mint);
export const resetPositions = () => {
  positions.clear();
  dailyRealizedPnl = 0;
};
export const getDailyRealizedPnl = () => dailyRealizedPnl;
export const resetDailyRealizedPnl = () => { dailyRealizedPnl = 0; };

// Compact view of open positions for the Mini App.
export const snapshot = () =>
  [...positions.values()].map((p) => ({
    mint: p.mint,
    pct: p.lastPct === undefined ? null : Number(p.lastPct.toFixed(1)),
    ageSec: Math.round((Date.now() - p.openedAt) / 1000),
    half: p.tookHalf,
  }));

export async function openPaper(mint, sig, deps = {}) {
  const quoteFn = deps.getQuote ?? getQuote;
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const now = deps.now ? deps.now() : Date.now();
  const retryDelayMs = deps.retryDelayMs !== undefined ? deps.retryDelayMs : 2000;

  if (positions.size >= cfg.maxOpen) return logFn("skip_maxopen", { mint });

  let q = await quoteFn(mint);
  if (!q && retryDelayMs > 0) {
    await new Promise((r) => setTimeout(r, retryDelayMs));
    q = await quoteFn(mint);
  }
  if (!q) return logFn("skip_noquote", { mint });
  if (q.liqUsd < cfg.minLiqUsd) return logFn("skip_liquidity", { mint, liqUsd: q.liqUsd });

  const entry = q.price * (1 + cfg.entrySlip);
  positions.set(mint, {
    mint, sig, entry,
    peak: entry,
    openedAt: now,
    liq0: q.liqUsd,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,       // pct points already banked (weighted)
    misses: 0,
  });
  logFn("paper_open", { mint, entry, liqUsd: q.liqUsd });
  notifyFn(`PAPER BUY ${mint}\nentry ${entry}\nliq $${Math.round(q.liqUsd)}`);
  return true;
}

// Pure rule engine. Returns null, { partial }, or { exit } with reason and pct.
export function evaluate(p, q, now = Date.now()) {
  const px = q.price * (1 - cfg.exitSlip);          // pessimistic executable price
  const pct = (px / p.entry - 1) * 100;
  p.lastPct = pct;
  const newHigh = px > p.peak;
  if (newHigh) p.peak = px;

  if (pct <= -R.stopLoss) return { exit: "stop_loss", pct };
  if (q.liqUsd < p.liq0 * (1 - R.liqDrop / 100)) return { exit: "liquidity_drop", pct };
  if (now - p.openedAt >= R.maxHoldMin * 60000) return { exit: "max_hold", pct };

  if (pct >= R.trailArm) p.trailArmed = true;
  if (p.trailArmed && px <= p.peak * (1 - R.trail / 100)) return { exit: "trailing_stop", pct };

  if (!p.tookHalf && pct >= R.takeProfit) return { partial: "take_profit_half", pct };

  const inBand = pct >= -R.bandDown && pct <= R.bandUp;
  if (inBand && !newHigh) {
    p.sidewaysSince ??= now;
    if (now - p.sidewaysSince >= R.timeStopSec * 1000) return { exit: "time_stop", pct };
  } else {
    p.sidewaysSince = null;
  }
  return null;
}

function close(p, reason, pct, deps = {}) {
  const logFn = deps.logFn ?? log;
  const notifyFn = deps.notifyFn ?? notify;
  const now = deps.now ?? Date.now();
  const weight = p.tookHalf ? 0.5 : 1;
  const pnl = p.realized + weight * pct;
  positions.delete(p.mint);
  dailyRealizedPnl += pnl;
  const heldSec = Math.round((now - p.openedAt) / 1000);
  logFn("paper_close", { mint: p.mint, reason, pnl: Number(pnl.toFixed(2)), heldSec });
  notifyFn(`PAPER EXIT ${p.mint}\n${reason}  pnl ${pnl.toFixed(1)}%  held ${heldSec}s`);
}

export function closePaperPosition(mint, reason = "manual_close", deps = {}) {
  const p = positions.get(mint);
  if (!p) return false;
  close(p, reason, p.lastPct ?? 0, deps);
  return true;
}

let busy = false;
export async function tick(deps = {}) {
  const quoteFn = deps.getQuote ?? getQuote;
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const now = deps.now ? deps.now() : Date.now();

  if (busy) return;
  busy = true;
  try {
    for (const p of [...positions.values()]) {
      const q = await quoteFn(p.mint);
      if (!q) {
        // No price for ~1 minute is treated as a rug: conservative accounting.
        if (++p.misses >= R.noQuoteTicks) close(p, "no_quote_total_loss", -100, { logFn, notifyFn, now });
        continue;
      }
      p.misses = 0;
      const res = evaluate(p, q, now);
      if (!res) continue;
      if (res.partial) {
        p.tookHalf = true;
        p.realized += 0.5 * res.pct;
        logFn("paper_partial", { mint: p.mint, reason: res.partial, pct: Number(res.pct.toFixed(1)) });
      } else {
        close(p, res.exit, res.pct, { logFn, notifyFn, now });
      }
    }
  } finally {
    busy = false;
  }
}
