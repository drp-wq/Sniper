import { cfg } from "./config.js";
import { getQuote } from "./price.js";
import { log } from "./log.js";
import { notify } from "./api.js";

const R = cfg.rules;
const positions = new Map(); // mint -> position
const opening = new Set();   // mints currently awaiting entry quote

export const openCount = () => positions.size;
export const isOpen = (mint) => positions.has(mint) || opening.has(mint);

// Internal helper exposed for deterministic unit tests only.
export function _resetPaperStateForTests() {
  positions.clear();
  opening.clear();
}

export async function openPaper(mint, sig, meta = {}, deps = {}) {
  const quoteFn = deps.getQuote ?? getQuote;
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const maxOpen = deps.maxOpen ?? cfg.maxOpen;
  const minLiqUsd = deps.minLiqUsd ?? cfg.minLiqUsd;
  const entrySlip = deps.entrySlip ?? cfg.entrySlip;

  if (!mint || typeof mint !== "string") {
    return logFn("skip_invalid_mint", { mint: String(mint ?? ""), ...meta });
  }
  if (positions.has(mint) || opening.has(mint)) {
    return logFn("signal_skip", { mint, reason: "position_already_open", ...meta });
  }
  if (positions.size + opening.size >= maxOpen) {
    return logFn("skip_maxopen", { mint, ...meta });
  }

  opening.add(mint);
  try {
    const q = await quoteFn(mint);
    if (!q) return logFn("skip_noquote", { mint, ...meta });
    if (q.liqUsd < minLiqUsd) {
      return logFn("skip_liquidity", { mint, liqUsd: q.liqUsd, ...meta });
    }
    // Atomic post-await re-check in case another entry completed concurrently.
    if (positions.has(mint)) {
      return logFn("signal_skip", { mint, reason: "position_already_open", ...meta });
    }
    if (positions.size >= maxOpen) {
      return logFn("skip_maxopen", { mint, ...meta });
    }

    const entry = q.price * (1 + entrySlip);
    positions.set(mint, {
      mint,
      sig,
      entry,
      peak: entry,
      openedAt: Date.now(),
      liq0: q.liqUsd,
      pair: q.pair ?? null,
      sidewaysSince: null,
      trailArmed: false,
      tookHalf: false,
      realized: 0,       // pct points already banked (weighted)
      misses: 0,
      ...meta,
    });
    logFn("paper_open", {
      mint,
      sig: sig || null,
      entry,
      liqUsd: q.liqUsd,
      pair: q.pair ?? null,
      ...meta,
    });
    notifyFn(`PAPER BUY ${mint}\nentry ${entry}\nliq $${Math.round(q.liqUsd)}`);
  } finally {
    opening.delete(mint);
  }
}

// Pure rule engine. Returns null, { partial }, or { exit } with reason and pct.
export function evaluate(p, q, now = Date.now()) {
  const px = q.price * (1 - cfg.exitSlip);          // pessimistic executable price
  const pct = (px / p.entry - 1) * 100;
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

function close(p, reason, pct) {
  const weight = p.tookHalf ? 0.5 : 1;
  const pnl = p.realized + weight * pct;
  positions.delete(p.mint);
  const heldSec = Math.round((Date.now() - p.openedAt) / 1000);
  log("paper_close", { mint: p.mint, reason, pnl: Number(pnl.toFixed(2)), heldSec });
  notify(`PAPER EXIT ${p.mint}\n${reason}  pnl ${pnl.toFixed(1)}%  held ${heldSec}s`);
}

let busy = false;
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const p of [...positions.values()]) {
      const q = await getQuote(p.mint);
      if (!q) {
        // No price for ~1 minute is treated as a rug: conservative accounting.
        if (++p.misses >= R.noQuoteTicks) close(p, "no_quote_total_loss", -100);
        continue;
      }
      p.misses = 0;
      const res = evaluate(p, q);
      if (!res) continue;
      if (res.partial) {
        p.tookHalf = true;
        p.realized += 0.5 * res.pct;
        log("paper_partial", { mint: p.mint, reason: res.partial, pct: Number(res.pct.toFixed(1)) });
      } else {
        close(p, res.exit, res.pct);
      }
    }
  } finally {
    busy = false;
  }
}
