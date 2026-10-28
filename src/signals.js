// Pure helpers for signal identity and queue/latency checks.
// No dependencies; safe to test with Node's built-in test runner.

export function signalKey(signal) {
  const mint = typeof signal?.mint === "string" ? signal.mint.trim() : "";
  const sig = typeof signal?.sig === "string" ? signal.sig.trim() : "";
  if (sig) return `${sig}:${mint}`;
  // Without a transaction signature, deduplication cannot be reliable across retries.
  return `queue:${signal?.id ?? "unknown"}:${mint}`;
}

function parsePositiveTimestamp(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function signalAgeMs(signal, now = Date.now()) {
  const receivedAt = parsePositiveTimestamp(signal?.ts);
  if (receivedAt === null) return null;

  const rawChainTs = parsePositiveTimestamp(signal?.chainTs);
  let effectiveTs = receivedAt;
  if (rawChainTs !== null) {
    // Convert Unix seconds to ms when comparing against realistic epoch-ms timestamps.
    const chainTsMs = rawChainTs < 1e11 && now >= 1e12 ? rawChainTs * 1000 : rawChainTs;
    if (chainTsMs > 0 && chainTsMs < effectiveTs) {
      effectiveTs = chainTsMs;
    }
  }
  return Math.max(0, now - effectiveTs);
}

export function sequenceGap(since, oldestId) {
  if (!Number.isFinite(since) || since <= 0 || !Number.isFinite(oldestId)) return 0;
  return Math.max(0, oldestId - since - 1);
}
