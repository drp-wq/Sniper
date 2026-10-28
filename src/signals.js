// Pure helpers for signal identity and queue/latency checks.
// No dependencies; safe to test with Node's built-in test runner.

export function signalKey(signal) {
  const mint = typeof signal?.mint === "string" ? signal.mint.trim() : "";
  const sig = typeof signal?.sig === "string" ? signal.sig.trim() : "";
  if (sig) return `${sig}:${mint}`;
  // Without a transaction signature, deduplication cannot be reliable across retries.
  return `queue:${signal?.id ?? "unknown"}:${mint}`;
}

export function signalAgeMs(signal, now = Date.now()) {
  const receivedAt = Number(signal?.ts);
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null;
  return Math.max(0, now - receivedAt);
}

export function sequenceGap(since, oldestId) {
  if (!Number.isFinite(since) || since < 0 || !Number.isFinite(oldestId)) return 0;
  return Math.max(0, oldestId - since - 1);
}
