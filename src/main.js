import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { redactSecrets } from "./rpc.js";
import { getSignals, heartbeat, notify } from "./api.js";
import { runGate } from "./gate.js";
import {
  openPaper,
  tick,
  openCount,
  isOpen,
  loadPositions,
  savePositions,
  getConsumerState,
  setConsumerState,
  isSignalProcessed,
  markSignalProcessed,
} from "./paper.js";
import { log } from "./log.js";
import { signalAgeMs, signalKey, sequenceGap } from "./signals.js";

// Inspect retained backlog at startup. Old signals are logged, not traded.
let since = 0;
const seen = new Set();
const SEEN_MAX = 5000;
let stopping = false;
let activeStateFile = null;
let syncedConsumerEpoch = 0;

function rememberKey(key) {
  if (typeof key !== "string" || !key.trim()) return;
  seen.add(key);
  if (seen.size > SEEN_MAX) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

function syncFromPersistedConsumer({ exact = false } = {}) {
  const persisted = getConsumerState();
  const epochChanged = persisted.epoch !== syncedConsumerEpoch;
  syncedConsumerEpoch = persisted.epoch;
  if (exact || epochChanged) {
    since = Number.isFinite(persisted.since) && persisted.since >= 0 ? persisted.since : 0;
    seen.clear();
  } else if (Number.isFinite(persisted.since) && persisted.since > since) {
    since = persisted.since;
  }
  for (const k of persisted.seenKeys) {
    if (!seen.has(k)) {
      seen.add(k);
      if (seen.size > SEEN_MAX) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
    }
  }
}

export async function handle(s, deps = {}) {
  const gateFn = deps.runGate ?? runGate;
  const openFn = deps.openPaper ?? openPaper;
  const isOpenFn = deps.isOpen ?? isOpen;
  const logFn = deps.log ?? log;
  const haltCheck = deps.isHalted ?? (() => existsSync("HALT"));
  const maxSignalAgeMs = deps.maxSignalAgeMs ?? cfg.maxSignalAgeMs;
  const nowFn = deps.now ?? Date.now;

  if (!s || typeof s.mint !== "string" || !s.mint.trim()) {
    logFn("signal_skip", {
      signalId: s?.id ?? null,
      reason: "invalid_signal_payload",
    });
    return { ok: true, retryable: false };
  }

  const key = signalKey(s);
  const receivedAgeMs = signalAgeMs(s, nowFn());

  logFn("signal_received", {
    signalId: s.id,
    signalKey: key,
    mint: s.mint,
    sig: s.sig || null,
    receivedAgeMs,
  });

  if (receivedAgeMs === null) {
    logFn("signal_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "missing_relay_timestamp",
    });
    return { ok: true, retryable: false };
  }

  if (receivedAgeMs > maxSignalAgeMs) {
    logFn("signal_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "stale_signal",
      receivedAgeMs,
      maxSignalAgeMs,
    });
    return { ok: true, retryable: false };
  }

  if (haltCheck()) {
    logFn("halted_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "local_halt",
    });
    return { ok: true, retryable: false };
  }

  if (isOpenFn(s.mint)) {
    logFn("signal_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "position_already_open",
    });
    return { ok: true, retryable: false };
  }

  const gateStartedAt = nowFn();
  let g;
  try {
    g = await gateFn(s.mint, cfg.gate);
  } catch (e) {
    logFn("gate_error", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      sig: s.sig || null,
      receivedAgeMs,
      gateMs: nowFn() - gateStartedAt,
      msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]),
    });
    return { ok: false, retryable: true, reason: "gate_error" };
  }

  const gateMs = nowFn() - gateStartedAt;
  const endToGateMs = signalAgeMs(s, nowFn());

  // Keep `lagMs` for backward compatibility with src/report.js while adding explicit fields.
  logFn("gate", {
    signalId: s.id,
    signalKey: key,
    mint: s.mint,
    sig: s.sig || null,
    pass: g.pass,
    reasons: g.reasons,
    top10Pct: g.top10Pct,
    lagMs: receivedAgeMs,
    receivedAgeMs: endToGateMs,
    gateMs,
  });

  if (!g.pass) return { ok: true, retryable: false };

  if (haltCheck()) {
    logFn("halted_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "local_halt_after_gate",
    });
    return { ok: true, retryable: false };
  }

  if (isOpenFn(s.mint)) {
    logFn("signal_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "position_already_open",
    });
    return { ok: true, retryable: false };
  }

  const entryStartedAt = nowFn();
  const openRes = await openFn(
    s.mint,
    s.sig,
    {
      signalId: s.id,
      signalKey: key,
      receivedAgeMs: endToGateMs,
      gateMs,
    },
    deps,
  );

  if (openRes && openRes.retryable === true) {
    return {
      ok: false,
      retryable: true,
      reason: openRes.reason ?? "entry_persistence_failed",
    };
  }

  logFn("entry_attempt_complete", {
    signalId: s.id,
    signalKey: key,
    mint: s.mint,
    entryAttemptMs: nowFn() - entryStartedAt,
    totalRelayToEntryMs: signalAgeMs(s, nowFn()),
  });
  return { ok: true, retryable: false };
}

export async function pollOnce(deps = {}) {
  const getSignalsFn = deps.getSignals ?? getSignals;
  const handleFn = deps.handle ?? handle;
  const logFn = deps.log ?? log;
  const haltCheck = deps.isHalted ?? (() => existsSync("HALT"));
  const saveFn = deps.savePositions ?? savePositions;
  const stateFile = deps.stateFile !== undefined ? deps.stateFile : activeStateFile;

  syncFromPersistedConsumer();

  const prevSince = since;
  const prevSeen = [...seen];

  const {
    signals = [],
    seq = since,
    oldestId = null,
    halt = false,
  } = await getSignalsFn(since);

  if (oldestId !== null) {
    const gap = sequenceGap(since, oldestId);
    if (gap > 0) {
      logFn("signal_gap", {
        since,
        oldestId,
        missingSequenceCount: gap,
      });
    }
  }

  const halted = Boolean(halt) || haltCheck();
  let hadRetryableFailure = false;
  let minFailedId = Infinity;
  let maxContiguousCompletedId = prevSince;

  // Process signals in deterministic ascending numeric ID order (invalid/missing IDs first so they are never skipped).
  const orderedSignals = (Array.isArray(signals) ? [...signals] : []).sort((a, b) => {
    const idA = Number(a?.id);
    const idB = Number(b?.id);
    const validA = Number.isFinite(idA) && idA > 0;
    const validB = Number.isFinite(idB) && idB > 0;
    if (!validA && !validB) return 0;
    if (!validA) return -1;
    if (!validB) return 1;
    return idA - idB;
  });

  for (const s of orderedSignals) {
    const key = signalKey(s);
    const sigId = Number(s?.id);
    const hasValidId = Number.isFinite(sigId) && sigId > 0;

    if (seen.has(key) || isSignalProcessed(key)) {
      seen.add(key);
      logFn("signal_duplicate", {
        signalId: s?.id ?? null,
        signalKey: key,
        mint: s?.mint ?? null,
        sig: s?.sig || null,
      });
      if (!hadRetryableFailure && hasValidId && sigId > maxContiguousCompletedId) {
        maxContiguousCompletedId = Math.floor(sigId);
      }
      continue;
    }

    if (halted || haltCheck()) {
      rememberKey(key);
      logFn("halted_skip", {
        signalId: s?.id ?? null,
        signalKey: key,
        mint: s?.mint ?? null,
        reason: "halt_active_at_poll",
      });
      if (!hadRetryableFailure && hasValidId && sigId > maxContiguousCompletedId) {
        maxContiguousCompletedId = Math.floor(sigId);
      }
      continue;
    }

    // Sequential processing prevents concurrent gate checks from racing MAX_OPEN.
    let res;
    try {
      res = await handleFn(s, deps);
    } catch (e) {
      logFn("error", {
        where: "handle",
        signalId: s?.id ?? null,
        signalKey: key,
        mint: s?.mint ?? null,
        msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]),
      });
      res = { ok: false, retryable: true };
    }

    if (res && res.retryable === true) {
      hadRetryableFailure = true;
      if (hasValidId && sigId < minFailedId) {
        minFailedId = Math.floor(sigId);
      }
      continue;
    }

    rememberKey(key);
    if (!hadRetryableFailure && hasValidId && sigId > maxContiguousCompletedId) {
      maxContiguousCompletedId = Math.floor(sigId);
    }
  }

  // Snapshot consumer state after any mid-batch openPaper saves, before applying unpersisted batch keys.
  const durableConsumer = getConsumerState();

  let nextSince = prevSince;
  if (hadRetryableFailure) {
    if (Number.isFinite(minFailedId) && minFailedId > 0) {
      nextSince = Math.max(prevSince, Math.min(maxContiguousCompletedId, minFailedId - 1));
    } else {
      nextSince = prevSince;
    }
  } else if (Number.isFinite(seq) && seq >= prevSince) {
    nextSince = Math.max(Math.floor(seq), maxContiguousCompletedId);
  } else {
    nextSince = maxContiguousCompletedId;
  }

  since = nextSince;
  setConsumerState({ since, seenKeys: [...seen], reset: false });

  if (stateFile) {
    const persisted = Boolean(saveFn(stateFile, { ...deps, log: logFn }));
    if (!persisted) {
      since = durableConsumer.since;
      seen.clear();
      for (const k of prevSeen) seen.add(k);
      for (const k of durableConsumer.seenKeys) seen.add(k);
      setConsumerState({
        since: durableConsumer.since,
        seenKeys: durableConsumer.seenKeys,
        reset: true,
      });
    }
  }
}

export function shutdown(signal = "SIGINT", deps = {}) {
  if (stopping) return false;
  stopping = true;

  const saveFn = deps.savePositions ?? savePositions;
  const logFn = deps.log ?? log;
  const openCountFn = deps.openCount ?? openCount;
  const isTest =
    process.env.NODE_ENV === "test" ||
    process.env.NODE_TEST_CONTEXT !== undefined ||
    process.execArgv.some((arg) => arg.startsWith("--test"));
  const exitFn = deps.exit ?? (isTest ? () => {} : (code) => process.exit(code));

  setConsumerState({ since, seenKeys: [...seen] });
  const persisted = Boolean(saveFn(deps.stateFile, deps));
  logFn("stop", {
    signal,
    persisted,
    openPositions: openCountFn(),
  });
  exitFn(0);
  return true;
}

export function _resetMainStateForTests(initialSince = 0) {
  since = initialSince;
  seen.clear();
  stopping = false;
  activeStateFile = null;
  setConsumerState({ since: initialSince, seenKeys: [], reset: true });
  syncedConsumerEpoch = getConsumerState().epoch;
}

async function pollLoop() {
  if (stopping) return;
  try {
    await pollOnce();
  } catch (e) {
    log("error", { where: "poll", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) });
  }
  if (!stopping) {
    setTimeout(pollLoop, cfg.pollMs);
  }
}

export function startBot() {
  activeStateFile = "logs/positions.json";
  const restored = loadPositions(activeStateFile);
  syncFromPersistedConsumer({ exact: true });
  log("start", {
    pollMs: cfg.pollMs,
    paperOnly: true,
    startupBacklog: "inspect_retained_queue",
    maxSignalAgeMs: cfg.maxSignalAgeMs,
    restoredPositions: restored,
    restoredCursor: since,
  });

  notify(`Bot started (paper mode, restored=${restored})`);
  pollLoop();

  setInterval(
    () => tick().catch((e) => log("error", { where: "tick", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) })),
    cfg.priceMs,
  );

  setInterval(() => heartbeat(openCount()), cfg.heartbeatMs);
  heartbeat(openCount());

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => shutdown(sig));
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  startBot();
}
