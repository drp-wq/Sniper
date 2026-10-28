import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cfg } from "./config.js";
import { getQuote } from "./price.js";
import { log } from "./log.js";
import { redactSecrets } from "./rpc.js";
import { notify } from "./api.js";

const R = cfg.rules;
const positions = new Map(); // mint -> position
const opening = new Set();   // mints currently awaiting entry quote
const archivedUnresolved = []; // archived positions after prolonged missing quotes
let consumerSince = 0;       // persisted sequence cursor
let consumerEpoch = 0;       // incremented whenever loadPositions reloads consumer state from disk
const processedSignals = new Set(); // bounded deduplication keys persisted across restarts
const MAX_ARCHIVED_HISTORY = 500;
const MAX_PROCESSED_SIGNALS = 500;
const DEFAULT_STATE_FILE = "logs/positions.json";

export const openCount = () => positions.size;
export const isOpen = (mint) => positions.has(mint) || opening.has(mint);
export const getOpenPositions = () => [...positions.values()].map((p) => ({ ...p }));
export const getArchivedPositions = () => archivedUnresolved.map((p) => ({ ...p }));
export const getConsumerState = () => ({
  since: consumerSince,
  seenKeys: [...processedSignals],
  epoch: consumerEpoch,
});
export const isSignalProcessed = (key) =>
  typeof key === "string" && key.trim().length > 0 && processedSignals.has(key.trim());

export function markSignalProcessed(key) {
  if (typeof key !== "string" || !key.trim()) return;
  const clean = key.trim();
  if (processedSignals.has(clean)) {
    processedSignals.delete(clean);
  }
  processedSignals.add(clean);
  while (processedSignals.size > MAX_PROCESSED_SIGNALS) {
    const oldest = processedSignals.values().next().value;
    if (oldest === undefined) break;
    processedSignals.delete(oldest);
  }
}

function recordPositionSignalKeys(mint, sig, meta = {}) {
  const cleanMint = typeof mint === "string" ? mint.trim() : "";
  const cleanSig = typeof sig === "string" ? sig.trim() : "";
  if (typeof meta?.signalKey === "string" && meta.signalKey.trim()) {
    markSignalProcessed(meta.signalKey.trim());
  }
  if (cleanSig && cleanMint) {
    markSignalProcessed(`${cleanSig}:${cleanMint}`);
  }
  if (meta?.signalId !== undefined && meta?.signalId !== null && cleanMint) {
    markSignalProcessed(`queue:${meta.signalId}:${cleanMint}`);
  }
}

function hasProcessedPositionSignal(mint, sig, meta = {}) {
  const cleanMint = typeof mint === "string" ? mint.trim() : "";
  const cleanSig = typeof sig === "string" ? sig.trim() : "";
  if (typeof meta?.signalKey === "string" && isSignalProcessed(meta.signalKey)) return true;
  if (cleanSig && cleanMint && isSignalProcessed(`${cleanSig}:${cleanMint}`)) return true;
  if (
    !cleanSig &&
    meta?.signalId !== undefined &&
    meta?.signalId !== null &&
    cleanMint &&
    isSignalProcessed(`queue:${meta.signalId}:${cleanMint}`)
  ) {
    return true;
  }
  return false;
}

export function setConsumerState({ since, seenKeys, reset = false } = {}) {
  if (reset) {
    consumerSince = Number.isFinite(Number(since)) && Number(since) >= 0 ? Math.floor(Number(since)) : 0;
    processedSignals.clear();
  } else if (Number.isFinite(Number(since)) && Number(since) >= 0) {
    consumerSince = Math.max(consumerSince, Math.floor(Number(since)));
  }
  if (Array.isArray(seenKeys)) {
    for (const k of seenKeys.slice(-MAX_PROCESSED_SIGNALS)) {
      markSignalProcessed(k);
    }
  }
}

export function savePositions(stateFile = DEFAULT_STATE_FILE, deps = {}) {
  if (!stateFile) return true;
  const logFn = deps.log ?? log;
  const writeFn = deps.writeFileSync ?? writeFileSync;
  const renameFn = deps.renameSync ?? renameSync;
  const mkdirFn = deps.mkdirSync ?? mkdirSync;

  try {
    mkdirFn(dirname(stateFile), { recursive: true });
    const tmpFile = `${stateFile}.tmp`;
    const payload = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        positions: [...positions.values()],
        archivedUnresolved: archivedUnresolved.slice(-MAX_ARCHIVED_HISTORY),
        consumer: {
          since: consumerSince,
          seenKeys: [...processedSignals].slice(-MAX_PROCESSED_SIGNALS),
        },
      },
      null,
      2,
    );
    writeFn(tmpFile, payload, "utf8");
    renameFn(tmpFile, stateFile);
    return true;
  } catch (e) {
    logFn("error", { where: "savePositions", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) });
    return false;
  }
}

export function loadPositions(stateFile = DEFAULT_STATE_FILE, deps = {}) {
  const logFn = deps.log ?? log;
  const maxOpen = deps.maxOpen ?? cfg.maxOpen;
  if (!stateFile || !existsSync(stateFile)) return 0;

  try {
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.positions) ? raw.positions : []);
    const archivedList = Array.isArray(raw?.archivedUnresolved) ? raw.archivedUnresolved : [];
    const rawConsumer = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.consumer : null;

    positions.clear();
    opening.clear();
    archivedUnresolved.length = 0;
    consumerSince = 0;
    processedSignals.clear();
    consumerEpoch += 1;

    if (rawConsumer && typeof rawConsumer === "object") {
      if (Number.isFinite(Number(rawConsumer.since)) && Number(rawConsumer.since) >= 0) {
        consumerSince = Math.floor(Number(rawConsumer.since));
      }
      if (Array.isArray(rawConsumer.seenKeys)) {
        for (const k of rawConsumer.seenKeys.slice(-MAX_PROCESSED_SIGNALS)) {
          markSignalProcessed(k);
        }
      }
    }

    const archivedMints = new Set();
    for (const arch of archivedList.slice(-MAX_ARCHIVED_HISTORY)) {
      if (arch && typeof arch.mint === "string" && arch.mint.trim()) {
        const cleanMint = arch.mint.trim();
        archivedUnresolved.push({ ...arch, mint: cleanMint });
        archivedMints.add(cleanMint);
        recordPositionSignalKeys(cleanMint, arch.sig, arch);
      }
    }

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
      const cleanMint = item.mint.trim();
      // Never resurrect archived positions on restart
      if (positions.has(cleanMint) || archivedMints.has(cleanMint)) continue;

      const entry = Number(item.entry);
      const restoredPos = {
        ...item,
        mint: cleanMint,
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
        missingSince: Number.isFinite(Number(item.missingSince)) ? Number(item.missingSince) : null,
        unresolvedMissingQuote: Boolean(item.unresolvedMissingQuote),
        lastQuotePrice: Number.isFinite(Number(item.lastQuotePrice)) ? Number(item.lastQuotePrice) : null,
        lastExecPrice: Number.isFinite(Number(item.lastExecPrice)) ? Number(item.lastExecPrice) : entry,
        lastLiqUsd: Number.isFinite(Number(item.lastLiqUsd)) ? Number(item.lastLiqUsd) : Number(item.liq0 ?? 0),
        lastQuoteAt: Number.isFinite(Number(item.lastQuoteAt)) ? Number(item.lastQuoteAt) : Number(item.openedAt),
      };
      positions.set(restoredPos.mint, restoredPos);
      recordPositionSignalKeys(cleanMint, restoredPos.sig, restoredPos);
      restored += 1;
    }

    if (restored > 0 || archivedUnresolved.length > 0) {
      logFn("positions_restored", {
        count: restored,
        archivedUnresolvedCount: archivedUnresolved.length,
        mints: [...positions.keys()],
      });
    }
    return restored;
  } catch (e) {
    logFn("error", { where: "loadPositions", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) });
    return 0;
  }
}

// Internal helper exposed for deterministic unit tests only.
export function _resetPaperStateForTests() {
  positions.clear();
  opening.clear();
  archivedUnresolved.length = 0;
  consumerSince = 0;
  processedSignals.clear();
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openPaper(mint, sig, meta = {}, deps = {}) {
  const quoteFn = deps.getQuote ?? getQuote;
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const maxOpen = deps.maxOpen ?? cfg.maxOpen;
  const minLiqUsd = deps.minLiqUsd ?? cfg.minLiqUsd;
  const entrySlip = deps.entrySlip ?? cfg.entrySlip;
  const entryQuoteRetries = deps.entryQuoteRetries ?? cfg.entryQuoteRetries;
  const entryQuoteRetryMs = deps.entryQuoteRetryMs ?? cfg.entryQuoteRetryMs;
  const haltCheck = deps.isHalted ?? (() => existsSync("HALT"));
  const sleepFn = deps.sleep ?? defaultSleep;
  const stateFile = deps.stateFile !== undefined ? deps.stateFile : DEFAULT_STATE_FILE;
  const nowFn = deps.now ?? Date.now;

  if (!mint || typeof mint !== "string") {
    return logFn("skip_invalid_mint", { mint: String(mint ?? ""), ...meta });
  }
  if (haltCheck()) {
    return logFn("halted_skip", { mint, reason: "local_halt_at_entry", ...meta });
  }
  if (positions.has(mint) || opening.has(mint)) {
    return logFn("signal_skip", { mint, reason: "position_already_open", ...meta });
  }
  if (hasProcessedPositionSignal(mint, sig, meta)) {
    return logFn("signal_duplicate", {
      mint,
      sig: sig || null,
      reason: "signal_already_processed",
      ...meta,
    });
  }
  if (positions.size + opening.size >= maxOpen) {
    return logFn("skip_maxopen", { mint, ...meta });
  }

  opening.add(mint);
  try {
    const maxAttempts = Math.max(1, 1 + Math.min(5, Math.max(0, Math.floor(entryQuoteRetries))));
    let q = null;
    let quoteAttempts = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (haltCheck()) {
        return logFn("halted_skip", { mint, reason: "halt_during_quote_retry", quoteAttempts, ...meta });
      }
      quoteAttempts = attempt;
      q = await quoteFn(mint);
      if (q && Number.isFinite(Number(q.price)) && Number(q.price) > 0) {
        break;
      }
      q = null;
      if (attempt < maxAttempts) {
        if (haltCheck()) {
          return logFn("halted_skip", { mint, reason: "halt_before_quote_retry_wait", quoteAttempts, ...meta });
        }
        await sleepFn(entryQuoteRetryMs);
        if (haltCheck()) {
          return logFn("halted_skip", { mint, reason: "halt_after_quote_retry_wait", quoteAttempts, ...meta });
        }
      }
    }

    if (!q) {
      return logFn("skip_noquote", { mint, quoteAttempts, ...meta });
    }
    if (haltCheck()) {
      return logFn("halted_skip", { mint, reason: "halt_before_paper_open", quoteAttempts, ...meta });
    }
    if (q.liqUsd < minLiqUsd) {
      return logFn("skip_liquidity", { mint, liqUsd: q.liqUsd, quoteAttempts, ...meta });
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
    const prevProcessed = [...processedSignals];
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
      missingSince: null,
      unresolvedMissingQuote: false,
      lastQuotePrice: q.price,
      lastExecPrice: entry,
      lastLiqUsd: q.liqUsd,
      lastQuoteAt: now,
      quoteAttempts,
      ...meta,
    });
    recordPositionSignalKeys(mint, sig, meta);
    const saveFn = deps.savePositions ?? savePositions;
    const persisted = Boolean(saveFn(stateFile, deps));
    if (!persisted) {
      positions.delete(mint);
      processedSignals.clear();
      for (const k of prevProcessed) processedSignals.add(k);
      logFn("error", {
        where: "openPaper",
        mint,
        msg: "failed to persist opened position; rolling back paper entry",
      });
      return { ok: false, retryable: true, reason: "persistence_failed" };
    }
    logFn("paper_open", {
      mint,
      sig: sig || null,
      entry,
      rawEntryQuote: q.price,
      entrySlip,
      liqUsd: q.liqUsd,
      pair: q.pair ?? null,
      quoteAttempts,
      ...meta,
    });
    notifyFn(`PAPER BUY ${mint}\nentry ${entry}\nliq $${Math.round(q.liqUsd)}`);
    return { ok: true, opened: true };
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

  const prevProcessed = [...processedSignals];
  positions.delete(p.mint);
  recordPositionSignalKeys(p.mint, p.sig, p);
  const saveFn = deps.savePositions ?? savePositions;
  const persisted = Boolean(saveFn(stateFile, deps));
  if (!persisted) {
    positions.set(p.mint, p);
    processedSignals.clear();
    for (const k of prevProcessed) processedSignals.add(k);
    logFn("error", {
      where: "close",
      mint: p.mint,
      msg: "failed to persist closed position; keeping active position open",
    });
    return false;
  }

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

function archiveUnresolvedPosition(p, now, deps = {}) {
  const logFn = deps.log ?? log;
  const notifyFn = deps.notify ?? notify;
  const stateFile = deps.stateFile !== undefined ? deps.stateFile : DEFAULT_STATE_FILE;

  const lastUnrealizedPct =
    Number.isFinite(p.lastExecPrice) && p.entry > 0
      ? Number((((p.lastExecPrice / p.entry) - 1) * 100).toFixed(2))
      : null;
  const missingDurationSec = Number.isFinite(p.missingSince)
    ? Math.max(0, Math.round((now - p.missingSince) / 1000))
    : null;

  const archivedEntry = {
    ...p,
    archivedAt: now,
    missingDurationSec,
    lastUnrealizedPct,
  };

  // Stage removal and archival, then verify atomic persistence before committing
  positions.delete(p.mint);
  recordPositionSignalKeys(p.mint, p.sig, p);
  archivedUnresolved.push(archivedEntry);
  if (archivedUnresolved.length > MAX_ARCHIVED_HISTORY) {
    archivedUnresolved.shift();
  }

  const persisted = savePositions(stateFile, deps);
  if (!persisted) {
    // Rollback in-memory archival if disk persistence failed so we never silently lose state
    archivedUnresolved.pop();
    positions.set(p.mint, p);
    logFn("error", {
      where: "archiveUnresolvedPosition",
      mint: p.mint,
      msg: "failed to persist archived unresolved position; keeping active slot reserved",
    });
    return false;
  }

  logFn("paper_archived_unresolved", {
    mint: p.mint,
    sig: p.sig ?? null,
    signalId: p.signalId ?? null,
    reason: "missing_quote_timeout",
    misses: p.misses,
    missingDurationSec,
    entry: p.entry,
    tookHalf: Boolean(p.tookHalf),
    realizedBankedPct: Number((p.realized ?? 0).toFixed(2)),
    lastQuotePrice: p.lastQuotePrice ?? null,
    lastExecPrice: p.lastExecPrice ?? null,
    lastLiqUsd: p.lastLiqUsd ?? null,
    lastQuoteAt: p.lastQuoteAt ?? null,
    lastUnrealizedPct,
  });
  notifyFn(
    `PAPER ARCHIVED UNRESOLVED ${p.mint}\nmissing quotes for ${missingDurationSec ?? "?"}s; archived without synthetic close`,
  );
  return true;
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
  const maxUnresolvedMin = deps.maxUnresolvedMin ?? R.maxUnresolvedMin;

  try {
    let dirty = false;
    for (const p of [...positions.values()]) {
      const q = await quoteFn(p.mint, { preferredPair: p.pair });
      const now = nowFn();

      if (!q || !Number.isFinite(Number(q.price)) || Number(q.price) <= 0) {
        p.misses = (p.misses ?? 0) + 1;
        p.missingSince ??= now;
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
            missingSince: p.missingSince,
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

        // Archive long-unresolved positions once continuous missing duration reaches maxUnresolvedMin
        if (
          p.unresolvedMissingQuote &&
          Number.isFinite(p.missingSince) &&
          now - p.missingSince >= maxUnresolvedMin * 60000
        ) {
          const archivedOk = archiveUnresolvedPosition(p, now, {
            ...deps,
            log: logFn,
            notify: notifyFn,
            stateFile,
          });
          if (archivedOk) {
            dirty = false; // archiveUnresolvedPosition already persisted state
          }
        }
        continue;
      }

      if (p.unresolvedMissingQuote) {
        logFn("paper_quote_recovered", {
          mint: p.mint,
          sig: p.sig ?? null,
          signalId: p.signalId ?? null,
          missesBeforeRecovery: p.misses,
          missingDurationSec: Number.isFinite(p.missingSince)
            ? Math.max(0, Math.round((now - p.missingSince) / 1000))
            : null,
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
      p.missingSince = null;
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
        close(p, res.exit, res.pct, q, { ...deps, log: logFn, notify: notifyFn, stateFile, now: nowFn, exitSlip });
        dirty = false; // close() already persisted positions
      }
    }

    if (dirty) {
      savePositions(stateFile, deps);
    }
  } finally {
    busy = false;
  }
}
