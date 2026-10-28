import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cfg } from "./config.js";
import { getSignals, heartbeat, notify } from "./api.js";
import { runGate } from "./gate.js";
import { openPaper, tick, openCount, isOpen, loadPositions, savePositions } from "./paper.js";
import { log } from "./log.js";
import { signalAgeMs, signalKey, sequenceGap } from "./signals.js";

// Inspect retained backlog at startup. Old signals are logged, not traded.
let since = 0;
const seen = new Set();
const SEEN_MAX = 5000;
let stopping = false;

function rememberKey(key) {
  seen.add(key);
  if (seen.size > SEEN_MAX) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
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
    return;
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
    return;
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
    return;
  }

  if (haltCheck()) {
    logFn("halted_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "local_halt",
    });
    return;
  }

  if (isOpenFn(s.mint)) {
    logFn("signal_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "position_already_open",
    });
    return;
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
      msg: String(e),
    });
    return;
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

  if (!g.pass) return;

  if (haltCheck()) {
    logFn("halted_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "local_halt_after_gate",
    });
    return;
  }

  if (isOpenFn(s.mint)) {
    logFn("signal_skip", {
      signalId: s.id,
      signalKey: key,
      mint: s.mint,
      reason: "position_already_open",
    });
    return;
  }

  const entryStartedAt = nowFn();
  await openFn(s.mint, s.sig, {
    signalId: s.id,
    signalKey: key,
    receivedAgeMs: endToGateMs,
    gateMs,
  });

  logFn("entry_attempt_complete", {
    signalId: s.id,
    signalKey: key,
    mint: s.mint,
    entryAttemptMs: nowFn() - entryStartedAt,
    totalRelayToEntryMs: signalAgeMs(s, nowFn()),
  });
}

export async function pollOnce(deps = {}) {
  const getSignalsFn = deps.getSignals ?? getSignals;
  const handleFn = deps.handle ?? handle;
  const logFn = deps.log ?? log;
  const haltCheck = deps.isHalted ?? (() => existsSync("HALT"));

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

  if (Number.isFinite(seq) && seq >= since) {
    since = seq;
  }

  const halted = Boolean(halt) || haltCheck();

  for (const s of signals) {
    const key = signalKey(s);

    if (seen.has(key)) {
      logFn("signal_duplicate", {
        signalId: s?.id ?? null,
        signalKey: key,
        mint: s?.mint ?? null,
        sig: s?.sig || null,
      });
      continue;
    }

    rememberKey(key);

    if (halted || haltCheck()) {
      logFn("halted_skip", {
        signalId: s?.id ?? null,
        signalKey: key,
        mint: s?.mint ?? null,
        reason: "halt_active_at_poll",
      });
      continue;
    }

    // Sequential processing prevents concurrent gate checks from racing MAX_OPEN.
    try {
      await handleFn(s, deps);
    } catch (e) {
      logFn("error", {
        where: "handle",
        signalId: s?.id ?? null,
        signalKey: key,
        mint: s?.mint ?? null,
        msg: String(e),
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
}

async function pollLoop() {
  if (stopping) return;
  try {
    await pollOnce();
  } catch (e) {
    log("error", { where: "poll", msg: String(e) });
  }
  if (!stopping) {
    setTimeout(pollLoop, cfg.pollMs);
  }
}

export function startBot() {
  const restored = loadPositions();
  log("start", {
    pollMs: cfg.pollMs,
    paperOnly: true,
    startupBacklog: "inspect_retained_queue",
    maxSignalAgeMs: cfg.maxSignalAgeMs,
    restoredPositions: restored,
  });

  notify(`Bot started (paper mode, restored=${restored})`);
  pollLoop();

  setInterval(
    () => tick().catch((e) => log("error", { where: "tick", msg: String(e) })),
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
