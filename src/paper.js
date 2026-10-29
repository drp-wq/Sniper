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

export function formatPrice(px) {
  if (!Number.isFinite(px) || px <= 0) return "$0.00";
  if (px < 0.00001) return `$${px.toFixed(8)}`;
  if (px < 0.01) return `$${px.toFixed(6)}`;
  if (px < 1) return `$${px.toFixed(4)}`;
  return `$${px.toFixed(2)}`;
}

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
  const slPrice = entry * (1 - R.stopLoss / 100);
  const tpPrice = entry * (1 + R.takeProfit / 100);
  const trailArmPrice = entry * (1 + R.trailArm / 100);
  const symbol = q.symbol || "TOKEN";
  const name = q.name || "Token";

  positions.set(mint, {
    mint, sig, entry,
    symbol, name,
    peak: entry,
    openedAt: now,
    liq0: q.liqUsd,
    sidewaysSince: null,
    trailArmed: false,
    tookHalf: false,
    realized: 0,       // pct points already banked (weighted)
    misses: 0,
  });
  logFn("paper_open", { mint, symbol, name, entry, liqUsd: q.liqUsd, slPrice, tpPrice, trailArmPrice });
  notifyFn(
    `🟢 [PAPER BUY] ${name} ($${symbol})\n` +
    `Mint: ${mint}\n` +
    `💵 Entry: ${formatPrice(entry)} (Screen: ${formatPrice(q.price)} +${(cfg.entrySlip * 100).toFixed(0)}% slip)\n` +
    `🛑 Stop-Loss: ${formatPrice(slPrice)} (-${R.stopLoss}%)\n` +
    `🎯 Take-Profit: ${formatPrice(tpPrice)} (+${R.takeProfit}% | Sell 50%)\n` +
    `🚀 Trailing Stop: Arms at ${formatPrice(trailArmPrice)} (+${R.trailArm}%)\n` +
    `💧 Liquidity: $${Math.round(q.liqUsd).toLocaleString()}`
  );
  return true;
}

// Dynamic rule engine with auto-breakeven and volatility-adaptive trailing stop.
// Returns null, { partial }, or { exit } with reason and pct.
export function evaluate(p, q, now = Date.now()) {
  const px = q.price * (1 - cfg.exitSlip);          // pessimistic executable price
  const pct = (px / p.entry - 1) * 100;
  p.lastPct = pct;
  const newHigh = px > p.peak;
  if (newHigh) p.peak = px;

  // 1. Dynamic Stop Loss: -25% initial risk cap, or Breakeven (0%) once half is banked
  const effectiveStopLoss = p.tookHalf ? 0 : -R.stopLoss;
  if (pct <= effectiveStopLoss) {
    return { exit: p.tookHalf ? "breakeven_stop" : "stop_loss", pct };
  }

  // 2. Dynamic Liquidity Drop: 30% baseline, accelerated to 20% if already in profit
  const liqThreshold = pct > 15 ? (1 - Math.min(R.liqDrop, 20) / 100) : (1 - R.liqDrop / 100);
  if (q.liqUsd < p.liq0 * liqThreshold) return { exit: "liquidity_drop", pct };

  // 3. Max Hold Timeout
  if (now - p.openedAt >= R.maxHoldMin * 60000) return { exit: "max_hold", pct };

  // 4. Trailing Stop with Dynamic Ratchet on Multi-bagger Runners
  if (pct >= R.trailArm) p.trailArmed = true;
  if (p.trailArmed) {
    const peakPct = (p.peak / p.entry - 1) * 100;
    let dynamicTrail = R.trail; // baseline 20%
    if (peakPct >= 200) dynamicTrail = Math.max(10, R.trail * 0.5);       // 10% on 3x+ moonshots
    else if (peakPct >= 100) dynamicTrail = Math.max(14, R.trail * 0.75); // 15% on 2x+ runners

    if (px <= p.peak * (1 - dynamicTrail / 100)) return { exit: "trailing_stop", pct };
  }

  // 5. Partial Take Profit Half (TP1)
  if (!p.tookHalf && pct >= R.takeProfit) return { partial: "take_profit_half", pct };

  // 6. Time Stop on Stagnant Sideways Action
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
  logFn("paper_close", { mint: p.mint, symbol: p.symbol, name: p.name, reason, pnl: Number(pnl.toFixed(2)), heldSec });
  notifyFn(
    `🔴 [PAPER EXIT] ${p.name || p.mint} (${p.symbol ? `$${p.symbol}` : p.mint})\n` +
    `Mint: ${p.mint}\n` +
    `Reason: ${reason}\n` +
    `PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%\n` +
    `Held: ${heldSec}s`
  );
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
        notifyFn(
          `💰 [PAPER 50% TP BANKED] ${p.name || p.mint} ($${p.symbol || 'TOKEN'})\n` +
          `Gain: +${res.pct.toFixed(1)}%\n` +
          `Status: 50% position banked, trailing remaining 50%`
        );
      } else {
        close(p, res.exit, res.pct, { logFn, notifyFn, now });
      }
    }
  } finally {
    busy = false;
  }
}
