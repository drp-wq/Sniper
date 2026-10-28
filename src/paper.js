import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cfg } from "./config.js";
import { getQuote } from "./price.js";
import { log } from "./log.js";
import { notify } from "./api.js";

const R = cfg.rules;
const positions = new Map(); // mint -> position
const opening = new Set();   // mints currently awaiting entry quote
const DEFAULT_STATE_FILE = "logs/positions.json";

export const openCount = () => positions.size;
export const isOpen = (mint) => positions.has(mint) || opening.has(mint);
export const getOpenPositions = () => [...positions.values()].map((p) => ({ ...p }));

export function savePositions(stateFile = DEFAULT_STATE_FILE) {
  if (!stateFile) return;
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    const tmpFile = `${stateFile}.tmp`;
    const payload = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        positions: [...positions.values()],
      },
      null,
      2,
    );
    writeFileSync(tmpFile, payload, "utf8");
    renameSync(tmpFile, stateFile);
  } catch (e) {
    log("error", { where: "savePositions", msg: String(e) });
  }
}

export function loadPositions(stateFile = DEFAULT_STATE_FILE, deps = {}) {
  const logFn = deps.log ?? log;
  const maxOpen = deps.maxOpen ?? cfg.maxOpen;
  if (!stateFile || !existsSync(stateFile)) return 0;

  try {
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.positions) ? raw.positions : []);
    let restored = 0;

    for (const item of list) {
      if (positions.size >= maxOpen) break;
      if (
        !item ||
        typeof item.mint !== "string" ||
        !item.mint.trim() ||
        !Number.isFinite(Number(item.entry)) ||
        Number(item.entry) <= 0 ||
        !Number.isFinite(Number(item.openedAt))
      ) {
        continue;
      }
      if (positions.has(item.mint)) continue;

      const entry = Number(item.entry);
      const restoredPos = {
        ...item,
        mint: item.mint.trim(),
        sig: item.sig ?? null,
        entry,
        rawEntryQuote: Number.isFinite(Number(item.rawEntryQuote)) ? Number(item.rawEntryQuote) : null,
        entrySlip: Number.isFinite(Number(item.entrySlip)) ? Number(item.entrySlip) : cfg.entrySlip,
        peak: Number.isFinite(Number(item.peak)) && Number(item.peak) > 0 ? Number(item.peak) : entry,
        openedAt: Number(item.openedAt),
        liq0: Number.isFinite(Number(item.liq0)) ? Number(item.liq0) : 0,
        pair: item.pair ?? null,
        sidewaysSince: Number.isFinite(Number(item.sidewaysSince)) ? Number(item.sidewaysSince) : null,
        trailArmed: Boolean(item.trailArmed),
        tookHalf: Boolean(item.tookHalf),
        halfRawPrice: Number.isFinite(Number(item.halfRawPrice)) ? Number(item.halfRawPrice) : null,
        realized: Number.isFinite(Number(item.realized)) ? Number(item.realized) : 0,
        misses: Number.isFinite(Number(item.misses)) ? Math.max(0, Math.floor(Number(item.misses))) : 0,
        unresolvedMissingQuote: Boolean(item.unresolvedMissingQuote),
        lastQuotePrice: Number.isFinite(Number(item.lastQuotePrice)) ? Number(item.lastQuotePrice) : null,
        lastExecPrice: Number.isFinite(Number(item.lastExecPrice)) ? Number(item.lastExecPrice) : entry,
        lastLiqUsd: Number.isFinite(Number(item.lastLiqUsd)) ? Number(item.lastLiqUsd) : Number(item.liq0 ?? 0),
        lastQuoteAt: Number.isFinite(Number(item.lastQuoteAt)) ? Number(item.lastQuoteAt) : Number(item.openedAt),
      };
      positions.set(restoredPos.mint, restoredPos);
      restored += 1;
    }

    if (restored > 0) {
      logFn("positions_restored", {
        count: restored,
        mints: [...positions.keys()],
      });
    }
    return restored;
  } catch (e) {
    logFn("error", { where: "loadPositions", msg: String(e) });
    return 0;
  }
}

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
  const stateFile = deps.stateFile !== undefined ? deps.stateFile : DEFAULT_STATE_FILE;
  const nowFn = deps.now ?? Date.now;

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
    if (!q || !Number.isFinite(Number(q.price)) || Number(q.price) <= 0) {
      return logFn("skip_noquote", { mint, ...meta });
    }
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

    const now = nowFn();
    const entry = q.price * (1 + entrySlip);
    positions.set(mint, {
      mint,
      sig: sig || null,
      entry,
      rawEntryQuote: q.price,
      entrySlip,
      peak: entry,
      openedAt: now,
      liq0: q.liqUsd,
      pair: q.pair ?? null,
      sidewaysSince: null,
      trailArmed: false,
      tookHalf: false,
      halfRawPrice: null,
      realized: 0,       // pct points already banked (weighted)
      misses: 0,
      unresolvedMissingQuote: false,
      lastQuotePrice: q.price,
      lastExecPrice: entry,
      lastLiqUsd: q.liqUsd,
      lastQuoteAt: now,
      ...meta,
    });
    savePositions(stateFile);
    logFn("paper_open", {
      mint,
      sig: sig || null,
      entry,
      rawEntryQuote: q.price,
      entrySlip,
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
export function evaluate(p, q, now = Date.now(), exitSlip = cfg.exitSlip) {
  const px = q.price * (1 - exitSlip);          // pessimistic executable price
  const pct = (px / p.entry - 1) * 100;
  const newHigh = px > p.peak;
  if (newHigh) p.peak = px;

  if (pct <= -R.stopLoss) return { exit: "stop_loss", pct, px };
  if (q.liqUsd < p.liq0 * (1 - R.liqDrop / 100)) return { exit: "liquidity_drop", pct, px };
  if (now - p.openedAt >= R.maxHoldMin * 60000) return { exit: "max_hold", pct, px };

  if (pct >= R.trailArm) p.trailArmed = true;
  if (p.trailArmed && px <= p.peak * (1 - R.trail / 100)) return { exit: "trailing_stop", pct, px };

  if (!p.tookHalf && pct >= R.takeProfit) return { partial: "take_profit_half", pct, px };

  const inBand = pct >= -R.bandDown && pct <= R.bandUp;
  if (inBand && !newHigh) {
    p.sidewaysSince ??= now;
    if (now - p.sidewaysSince >= R.timeStopSec * 1000) return { exit: "time_stop", pct, px };
  } else {
    p.sidewaysSince = null;
  }
  return null;
}

export function computeDoubleSlipPnl({
  rawEntryQuote,
  rawExitQuote,
  halfRawPrice = null,
  tookHalf = false,
  entrySlip = cfg.entrySlip,
  exitSlip = cfg.exitSlip,
}) {
  if (!Number.isFinite(rawEntryQuote) || rawEntryQuote <= 0 || !Number.isFinite(rawExitQuote) || rawExitQuote <= 0) {
    return null;
  }
  const entry2x = rawEntryQuote * (1 + Math.min(0.99, entrySlip * 2));
  const exitFactor2x = Math.max(0.01, 1 - exitSlip * 2);
  const exitPx2x = rawExitQuote * exitFactor2x;
  const finalPct2x = (exitPx2x / entry2x - 1) * 100;

  if (tookHalf && Number.isFinite(halfRawPrice) && halfRawPrice > 0) {
    const halfPx2x = halfRawPrice * exitFactor2x;
    const halfPct2x = (halfPx2x / entry2x - 1) * 100;
    return Number((0.5 * halfPct2x + 0.5 * finalPct2x).toFixed(2));
  }
  return Number(finalPct2x.toFixed(2));
}

function close(p, reason, pct, q, deps = {}) {
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const stateFile = deps.stateFile !== undefined ? deps.stateFile : DEFAULT_STATE_FILE;
  const nowFn = deps.now ?? Date.now;
  const exitSlip = deps.exitSlip ?? cfg.exitSlip;

  const weight = p.tookHalf ? 0.5 : 1;
  const pnl = p.realized + weight * pct;
  const pnl2xSlip = computeDoubleSlipPnl({
    rawEntryQuote: p.rawEntryQuote,
    rawExitQuote: q?.price,
    halfRawPrice: p.halfRawPrice,
    tookHalf: p.tookHalf,
    entrySlip: p.entrySlip ?? cfg.entrySlip,
    exitSlip,
  });

  positions.delete(p.mint);
  savePositions(stateFile);

  const heldSec = Math.round((nowFn() - p.openedAt) / 1000);
  logFn("paper_close", {
    mint: p.mint,
    sig: p.sig ?? null,
    signalId: p.signalId ?? null,
    reason,
    pnl: Number(pnl.toFixed(2)),
    ...(pnl2xSlip !== null ? { pnl2xSlip } : {}),
    heldSec,
    entry: p.entry,
    exitPrice: q ? Number((q.price * (1 - exitSlip)).toFixed(12)) : null,
    rawEntryQuote: p.rawEntryQuote ?? null,
    rawExitQuote: q?.price ?? null,
    liqUsd: q?.liqUsd ?? null,
    pair: q?.pair ?? p.pair ?? null,
  });
  notifyFn(`PAPER EXIT ${p.mint}\n${reason}  pnl ${pnl.toFixed(1)}%  held ${heldSec}s`);
}

let busy = false;
export async function tick(deps = {}) {
  if (busy) return;
  busy = true;

  const quoteFn = deps.getQuote ?? getQuote;
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const stateFile = deps.stateFile !== undefined ? deps.stateFile : DEFAULT_STATE_FILE;
  const nowFn = deps.now ?? Date.now;
  const exitSlip = deps.exitSlip ?? cfg.exitSlip;
  const noQuoteTicks = deps.noQuoteTicks ?? R.noQuoteTicks;

  try {
    let dirty = false;
    for (const p of [...positions.values()]) {
      const q = await quoteFn(p.mint, { preferredPair: p.pair });
      const now = nowFn();

      if (!q || !Number.isFinite(Number(q.price)) || Number(q.price) <= 0) {
        p.misses = (p.misses ?? 0) + 1;
        dirty = true;
        // Missing quote is NOT a confirmed -100% fill. Mark as unresolved and retain last known valuation.
        if (p.misses >= noQuoteTicks && !p.unresolvedMissingQuote) {
          p.unresolvedMissingQuote = true;
          const lastUnrealizedPct =
            Number.isFinite(p.lastExecPrice) && p.entry > 0
              ? Number((((p.lastExecPrice / p.entry) - 1) * 100).toFixed(2))
              : null;
          logFn("paper_unresolved", {
            mint: p.mint,
            sig: p.sig ?? null,
            signalId: p.signalId ?? null,
            reason: "missing_quote_threshold",
            misses: p.misses,
            lastQuotePrice: p.lastQuotePrice ?? null,
            lastExecPrice: p.lastExecPrice ?? null,
            lastLiqUsd: p.lastLiqUsd ?? null,
            lastQuoteAt: p.lastQuoteAt ?? null,
            lastUnrealizedPct,
          });
          notifyFn(
            `PAPER UNRESOLVED ${p.mint}\nmissing ${p.misses} quotes; retaining last valuation (not closing at -100%)`,
          );
        }
        continue;
      }

      if (p.unresolvedMissingQuote) {
        logFn("paper_quote_recovered", {
          mint: p.mint,
          sig: p.sig ?? null,
          signalId: p.signalId ?? null,
          missesBeforeRecovery: p.misses,
          price: q.price,
          liqUsd: q.liqUsd,
        });
      }

      if (q.pairSwitched && p.pair && q.pair && q.pair !== p.pair) {
        logFn("paper_pair_switched", {
          mint: p.mint,
          previousPair: p.pair,
          newPair: q.pair,
          liqUsd: q.liqUsd,
        });
        p.pair = q.pair;
      }

      p.misses = 0;
      p.unresolvedMissingQuote = false;
      p.lastQuotePrice = q.price;
      p.lastExecPrice = q.price * (1 - exitSlip);
      p.lastLiqUsd = q.liqUsd;
      p.lastQuoteAt = now;
      dirty = true;

      const res = evaluate(p, q, now, exitSlip);
      if (!res) continue;

      if (res.partial) {
        p.tookHalf = true;
        p.halfRawPrice = q.price;
        p.realized += 0.5 * res.pct;
        logFn("paper_partial", {
          mint: p.mint,
          sig: p.sig ?? null,
          signalId: p.signalId ?? null,
          reason: res.partial,
          pct: Number(res.pct.toFixed(1)),
          rawQuote: q.price,
          liqUsd: q.liqUsd,
        });
      } else {
        close(p, res.exit, res.pct, q, { log: logFn, notify: notifyFn, stateFile, now: nowFn, exitSlip });
        dirty = false; // close() already persisted positions
      }
    }

    if (dirty) {
      savePositions(stateFile);
    }
  } finally {
    busy = false;
  }
}
