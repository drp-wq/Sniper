# Sniper — Production Preflight, Final Release Gate Audit & Pre-Deployment Operator Package

**Repository**: `/workspaces/Sniper/Sniper` (`main` @ `edd06db6cc4f0919496d84197174e7f05dfc372d`)  
**Cloudflare Account**: `f4f693d6251ce1deeffca0d55d1ceb65` (`Pjdebnath01@gmail.com's Account`)  
**Target Worker**: `sniper-relay` (`https://sniper-relay.pjdebnath01.workers.dev`)  
**Last Updated**: `2026-10-28T11:03:50Z`  
**Status**: **PRODUCTION DEPLOYED & VERIFIED (`Version ID: 81088741-081d-4ddb-ac63-7d451aa6f4c6`, `migration_tag: "v1"`, `SignalQueueDO` namespace `c023214f59a84826b691477a0979cdab`, `use_sqlite: true`)**.

---

## 1. Session Audit Log

| Session / Timestamp (UTC) | Scope | Result / Verdict |
| :--- | :--- | :--- |
| `2026-10-28T10:20Z–10:23Z` | Production Preflight Verification (Read-Only) | Confirmed active Worker version `3cda09bb-afce-4ce3-91c1-1f69d3df52b1`, secrets (`APP_KEY`, `HELIUS_AUTH`), `SNIPER_KV` (`45cb5b16318f4534bce256f6d1fa9d5d`) keys (`queue`, `hb`, `alerted`), `0` prior DO migrations, and `0` Helius webhooks. |
| `2026-10-28T10:26Z–10:35Z` | Alerted TTL Preservation Fix & Local Regression Testing | Implemented `resolveKvAlertedUntilMs()` in `worker/index.js` using `KV.list({ prefix: "alerted" })` so `alerted` TTL is never extended on migration or fallback; added 6-part regression test suite in `test/signals.test.js` (`33/33` tests pass, `exit 0`). |
| `2026-10-28T10:37Z–10:44Z` | Path A & Path B Rollback Configuration Validation (Read-Only) | Validated both rollback configs via `wrangler deploy --dry-run` (`exit 0`) and traced Wrangler `4.154.0` `cli.js` migration resolution against live Cloudflare migration history (`migration_tag: null` pre-deploy -> `"v1"` post-deploy). |
| `2026-10-28T10:48Z–10:53Z` | Final Release Gate Audit & Pre-Deployment Operator Package | Reconfirmed live production state, `33/33` unit/regression tests (`exit 0`), Wrangler dry-run (`24.14 KiB / gzip: 5.69 KiB`, `exit 0`), paper-only safety boundary, and saved this persistent `audit_report.md` in `/workspaces/Sniper/Sniper/audit_report.md`. |
| `2026-10-28T11:00Z` | Local Git Commit (Authorized) | Staged and committed all 10 modified files, `wrangler.toml`, and `audit_report.md` on `main` (preserving `sniper-bot.zip` and `sniper_bot_checkpoint1_step_by_step.pdf` untracked and untouched). |
| `2026-10-28T11:02Z–11:04Z` | Production Deployment & Post-Deploy Read-Only Verification + Git Push (Authorized) | Executed pre-deploy webhook check (`0` webhooks) and KV backup (`PREDEPLOY_BACKUP_OK`); deployed `sniper-relay` (`Version ID: 81088741-081d-4ddb-ac63-7d451aa6f4c6`, `migration_tag: "v1"`, `SignalQueueDO` SQLite namespace `c023214f59a84826b691477a0979cdab`, `use_sqlite: true`); verified `401` auth guards and `POSTDEPLOY_VERIFIED_OK` (`seq: 0, oldestId: null, halt: false, hb: {ts: 1793178891285, open: 0}, alertedUntil: 1793186925000`); pushed `main` to `origin/main`. |

---

## 2. Release Gate Verdicts (By Path)

| Component / Path | Verdict | Summary |
| :--- | :--- | :--- |
| **Forward Deployment (`v1` SQLite DO + Local Hardening)** | **PASS WITH CONDITIONS** | All `33/33` unit/regression tests and Wrangler dry-run pass (`exit 0`). Requires executing the pre-deploy KV backup and webhook check (Section 4), plus noting the state-recovery conditions in Section 6. |
| **Rollback Path A (KV Fallback, Retaining `SignalQueueDO` & `v1` Migration)** | **PASS WITH CONDITIONS** | Safely routes 100% of traffic through `handleWithKvFallback` when `SIGNAL_QUEUE` is unbound while keeping `SignalQueueDO` exported and `tag = "v1"` intact. Requires restoring both `KV["queue"]` (with seeded `seenSigs`) and `KV["halt"]`, preserving `KV["hb"]`, and skipping `KV["alerted"]` when `alertedRemainingSec < 60`. |
| **Rollback Path B (Legacy Checkpoint 4 Bundle + `v2` `deleted_classes`)** | **PASS WITH CONDITIONS** | Standalone bundle (`0` imports) and `v2` migration syntax are valid, **but** permanently deletes `SignalQueueDO` SQLite storage and removes `handleWithKvFallback` hardening. Excluded from normal rollback; requires separate explicit authorization after verified state export. |

---

## 3. Live Production State vs. Local Configuration (Verified Read-Only)

| Check | Live Production State (`2026-10-28T10:51Z`) | Local `wrangler.toml` & `worker/index.js` | Reconciliation Status |
| :--- | :--- | :--- | :--- |
| **Active Worker Version** | `3cda09bb-afce-4ce3-91c1-1f69d3df52b1` (`100%`, deployed `2026-10-28T09:14:47.074Z`) | Bundle size `24.14 KiB / gzip: 5.69 KiB` (`npx wrangler deploy --dry-run`, `exit 0`) | Ready for forward deploy |
| **Bindings & Secrets** | `APP_KEY` (`secret_text`), `HELIUS_AUTH` (`secret_text`), `KV` (`45cb5b16318f4534bce256f6d1fa9d5d`) | Retains `KV` (`45cb5b16318f4534bce256f6d1fa9d5d`) + adds `SIGNAL_QUEUE` (`SignalQueueDO`); preserves secrets | Exact match |
| **DO Migration History** | `has_migration_tag: false`, `migration_tag: null`, `0` DO namespaces on account | `[[migrations]] tag = "v1" new_sqlite_classes = ["SignalQueueDO"]` | Clean initial `v1` migration |
| **`KV["queue"]` & Halt State** | `{"seq":0,"halt":false,"items":[]}` (no separate `"halt"` key in KV; live `GET /signals?since=0` returns `{"signals":[],"seq":0,"oldestId":1,"halt":false}`) | Migrates `seq: 0`, `halt: "0"`, `items: []` into `SignalQueueDO` (`oldestId: null` when empty) | Exact match |
| **`KV["hb"]` (Heartbeat)** | `{"ts":1793178891285,"open":0}` | Migrates `hb_ts = 1793178891285`, `hb_open = 0` into `SignalQueueDO` `meta` | Exact match |
| **`KV["alerted"]` & Expiry** | Value `"1"`, `expiration: 1793186925` (`2026-10-28T11:28:45Z`) | `resolveKvAlertedUntilMs` reads `KV.list({ prefix: "alerted" })` and sets `alerted_until = 1793186925000` without extending TTL | Exact match |
| **Helius Webhooks** | `GET /v0/webhooks` -> `HTTP 200`, `[]` (`0` active webhooks) | Zero webhook traffic during cutover | Quiet ingress confirmed |
| **Tracked Code Diff & Tests** | `10 files changed, 2191 insertions(+), 149 deletions(-)`, tracked diff SHA-256 `ce99f544704a02246c3b0d8d0da8eee5c0125d2bfa2061a0b0180e3a6f13419f` | `npm test`: **`33/33` pass** (`exit 0`); `wrangler deploy --dry-run`: **`exit 0`** | Verified |
| **Paper-Only & Archives** | Zero private-key, signing, swap, or `sendTransaction` paths; outer repo (`## main...origin/main [behind 6]`) & archive SHA-256s unchanged (`2227048c...`, `9aacc151...`, `62994bba...`) | Enforces `src/gate.js`, `MAX_OPEN` (`src/paper.js`), and local/remote `HALT` | Verified |

### Evidence Categories & Production Risks (`INCONCLUSIVE` Without Real Deployment)
1. **Independently Verified via Read-Only CLI/API (`Exit Code 0`)**:
   - Live Worker deployments (`wrangler deployments list`), script settings (`/settings`), DO namespaces (`/durable_objects/namespaces`), KV keys (`wrangler kv key list` / `get`), Helius webhooks (`GET /v0/webhooks`), live `/signals` auth & payload, syntax checks (`node --check` on all 15 JS files + `bash -n run.sh`), `npm test` (`33/33`), and `wrangler deploy --dry-run` (forward config, Path A config, and Path B config).
2. **`INCONCLUSIVE` Prior to Actual Authorized Deployment**:
   - Live Cloudflare edge control-plane provisioning of the `SignalQueueDO` SQLite namespace during `npx wrangler deploy`.
   - Live edge execution of `_migrateFromKvIfNeeded()` on the first request to `SignalQueueDO` against production `SNIPER_KV`.
   - Live edge transition to Path A (`SIGNAL_QUEUE` unbound after `v1`) or Path B (`v2` `deleted_classes`).

---

## 4. Pre-Deployment Operator Checklist (Read-Only Preconditions)

Run immediately before deployment (writes only to local `/tmp/sniper-kv-backup`):

```bash
# 1. [READ-ONLY] Fresh Helius webhook inventory check (must be 0 webhooks)
node -e '
const key = new URL(process.env.RPC_URL).searchParams.get("api-key");
const res = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${encodeURIComponent(key)}`);
const hooks = await res.json();
if (!res.ok || !Array.isArray(hooks) || hooks.length !== 0) {
  console.error("ABORT: Active Helius webhooks found:", hooks.length);
  process.exit(1);
}
console.log("WEBHOOK_CHECK_OK: 0 active webhooks");
'

# 2. [READ-ONLY] Backup all KV keys & key-level expiration metadata
mkdir -p /tmp/sniper-kv-backup
npx wrangler kv key list --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote > /tmp/sniper-kv-backup/keys-list.json
npx wrangler kv key get --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "queue" --text > /tmp/sniper-kv-backup/queue.json
npx wrangler kv key get --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "hb" --text > /tmp/sniper-kv-backup/hb.json
if jq -e '.[] | select(.name == "alerted")' /tmp/sniper-kv-backup/keys-list.json >/dev/null; then
  npx wrangler kv key get --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "alerted" --text > /tmp/sniper-kv-backup/alerted.txt || rm -f /tmp/sniper-kv-backup/alerted.txt
fi
if jq -e '.[] | select(.name == "halt")' /tmp/sniper-kv-backup/keys-list.json >/dev/null; then
  npx wrangler kv key get --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "halt" --text > /tmp/sniper-kv-backup/halt.txt
fi

# 3. [READ-ONLY] Validate backup files before deploying
node -e '
const fs = require("node:fs");
const assert = require("node:assert/strict");
const keys = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/keys-list.json", "utf8"));
const q = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/queue.json", "utf8"));
const hb = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/hb.json", "utf8"));
assert(Array.isArray(keys) && Number.isFinite(q.seq) && q.seq >= 0 && typeof q.halt === "boolean" && Array.isArray(q.items));
assert(Number.isFinite(hb.ts) && hb.ts > 0 && Number.isFinite(hb.open) && hb.open >= 0);
console.log("PREDEPLOY_BACKUP_OK", { seq: q.seq, halt: q.halt, items: q.items.length, hb });
'
```

---

## 5. Forward Deployment & Read-Only Post-Deployment Checks

### Step 5.1 — `[PRODUCTION WRITE]` Deploy Worker & Migration `v1` (Only After Explicit Authorization)
```bash
npx wrangler deploy --config /workspaces/Sniper/Sniper/wrangler.toml
```

### Step 5.2 — `[READ-ONLY]` Post-Deployment Verification (Default — No External State Writes)
*(Note: The first authenticated `GET` triggers the one-time internal KV-to-DO SQLite migration inside `SignalQueueDO`. Do not run `POST /halt` toggle tests unless separately authorized.)*
```bash
# 1. Verify migration_tag == "v1" and bindings (APP_KEY, HELIUS_AUTH, KV, SIGNAL_QUEUE)
curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/f4f693d6251ce1deeffca0d55d1ceb65/workers/scripts/sniper-relay/settings" \
  | jq '{migration_tag: .result.migration_tag, bindings: .result.bindings}'

# 2. Verify unauthenticated requests return HTTP 401
curl -s -o /dev/null -w "GET /signals: %{http_code}\n" "$WORKER_URL/signals"
curl -s -o /dev/null -w "GET /export-kv: %{http_code}\n" "$WORKER_URL/export-kv"
curl -s -o /dev/null -w "POST /hook: %{http_code}\n" -X POST "$WORKER_URL/hook"

# 3. Verify GET /signals?since=0 and GET /export-kv match pre-deploy backup without extending alerted TTL
curl -fsS -H "x-key: $APP_KEY" "$WORKER_URL/signals?since=0" > /tmp/sniper-kv-backup/postdeploy-signals.json
curl -fsS -H "x-key: $APP_KEY" "$WORKER_URL/export-kv" > /tmp/sniper-kv-backup/postdeploy-export-kv.json

node -e '
const fs = require("node:fs");
const assert = require("node:assert/strict");
const preQ = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/queue.json", "utf8"));
const preHb = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/hb.json", "utf8"));
const keys = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/keys-list.json", "utf8"));
const alertedMeta = keys.find((k) => k.name === "alerted");
const sigs = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/postdeploy-signals.json", "utf8"));
const exp = JSON.parse(fs.readFileSync("/tmp/sniper-kv-backup/postdeploy-export-kv.json", "utf8"));

assert.equal(exp.queue.seq, preQ.seq);
assert.equal(exp.queue.halt, Boolean(preQ.halt));
assert.deepEqual(exp.queue.items, preQ.items.slice(-50));
assert.equal(sigs.seq, exp.queue.seq);
assert.equal(sigs.oldestId, exp.queue.items.length ? exp.queue.items[0].id : null);
assert.deepEqual(exp.hb, { ts: Math.floor(Number(preHb.ts)), open: Math.floor(Number(preHb.open)) });
if (alertedMeta?.expiration) {
  assert.ok(exp.alertedUntil <= Number(alertedMeta.expiration) * 1000);
}
console.log("POSTDEPLOY_VERIFIED_OK", exp);
'
```

### Step 5.3 — Explicit Abort Conditions
Immediately abort and initiate **Path A Rollback** if:
1. `npx wrangler deploy` exits non-zero or fails migration `v1`.
2. Control-plane settings lack `migration_tag: "v1"`, `SIGNAL_QUEUE`, `KV`, `APP_KEY`, or `HELIUS_AUTH`.
3. Any unauthenticated check (`GET /signals`, `GET /export-kv`, `POST /hook`) returns anything other than `401`.
4. Authenticated `GET /signals?since=0` or `GET /export-kv` returns `503` or `500`.
5. `POSTDEPLOY_VERIFIED_OK` fails on `seq`, `halt`, `items`, `oldestId`, `hb`, or `alertedUntil`.

---

## 6. Path A Rollback Runbook (Non-Destructive KV Fallback)

### Step 6.1 — `[READ-ONLY]` Content-Aware Pre-Rollback Reconciliation (Queue Items, `seq`, Deduplication, `halt`, `hb`, `alerted`)
Before restoring any KV key, fetch live `/export-kv` (if reachable) and current KV state, and validate full content consistency:
```bash
curl -fsS -H "x-key: $APP_KEY" "$WORKER_URL/export-kv" > /tmp/sniper-kv-backup/rollback-export.json || rm -f /tmp/sniper-kv-backup/rollback-export.json
npx wrangler kv key get --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "queue" --text > /tmp/sniper-kv-backup/current-kv-queue.json
npx wrangler kv key get --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "hb" --text > /tmp/sniper-kv-backup/current-kv-hb.json

node -e '
const fs = require("node:fs");
const load = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const preQ = load("/tmp/sniper-kv-backup/queue.json");
const curQ = load("/tmp/sniper-kv-backup/current-kv-queue.json") ?? preQ;
const preHb = load("/tmp/sniper-kv-backup/hb.json");
const curHb = load("/tmp/sniper-kv-backup/current-kv-hb.json") ?? preHb;
const doExp = load("/tmp/sniper-kv-backup/rollback-export.json");

const baseQ = curQ.seq >= preQ.seq ? curQ : preQ;
let chosenQ = baseQ;
let chosenHb = (curHb?.ts ?? 0) >= (preHb?.ts ?? 0) ? curHb : preHb;
let chosenAlerted = { alerted: false, alertedRemainingSec: 0 };

if (doExp && doExp.queue) {
  if (doExp.queue.seq < baseQ.seq) {
    throw new Error(`ABORT_ROLLBACK: DO seq (${doExp.queue.seq}) < KV seq (${baseQ.seq})`);
  }
  const doById = new Map(doExp.queue.items.map((i) => [Number(i.id), i]));
  const cutoff = doExp.queue.seq - 50;
  for (const item of baseQ.items) {
    if (Number(item.id) > cutoff) {
      const m = doById.get(Number(item.id));
      if (!m || m.mint !== item.mint || (m.sig || "") !== (item.sig || "")) {
        throw new Error(`ABORT_ROLLBACK: Queue item mismatch at id=${item.id}`);
      }
    }
  }
  // Seed seenSigs from active items + any existing KV seenSigs so deduplication is preserved in KV fallback
  const mergedSeen = [...new Set([
    ...(Array.isArray(baseQ.seenSigs) ? baseQ.seenSigs : []),
    ...doExp.queue.items.filter((i) => i.sig && i.mint).map((i) => `${i.sig}:${i.mint}`),
  ])].slice(-1000);

  chosenQ = {
    seq: doExp.queue.seq,
    halt: Boolean(doExp.queue.halt || baseQ.halt),
    items: doExp.queue.items,
    seenSigs: mergedSeen,
  };
  if (doExp.hb && Number(doExp.hb.ts) >= Number(chosenHb?.ts ?? 0)) {
    chosenHb = doExp.hb;
  }
  chosenAlerted = {
    alerted: Boolean(doExp.alerted),
    alertedRemainingSec: Number(doExp.alertedRemainingSec ?? 0),
  };
}

fs.writeFileSync("/tmp/sniper-kv-backup/recover-queue.json", JSON.stringify(chosenQ));
fs.writeFileSync("/tmp/sniper-kv-backup/recover-halt.txt", chosenQ.halt ? "1" : "0");
fs.writeFileSync("/tmp/sniper-kv-backup/recover-hb.json", JSON.stringify(chosenHb));
fs.writeFileSync("/tmp/sniper-kv-backup/recover-alerted.json", JSON.stringify(chosenAlerted));
console.log("RECONCILE_READY_OK", { seq: chosenQ.seq, halt: chosenQ.halt, items: chosenQ.items.length, seenSigs: chosenQ.seenSigs?.length ?? 0, chosenAlerted });
'
```

### Step 6.2 — `[PRODUCTION WRITE]` Restore `KV["queue"]`, `KV["halt"]`, `KV["hb"]`, and Conditional `KV["alerted"]`
1. Restore `queue`, `halt` (`"1"` or `"0"` so `readKvQ` is consistent), and `hb`:
   ```bash
   npx wrangler kv key put --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "queue" --path=/tmp/sniper-kv-backup/recover-queue.json
   npx wrangler kv key put --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "halt" --path=/tmp/sniper-kv-backup/recover-halt.txt
   npx wrangler kv key put --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "hb" --path=/tmp/sniper-kv-backup/recover-hb.json
   ```
2. **Conditional `KV["alerted"]` Restoration (`60s` Minimum TTL Rule)**:
   - Only restore `"alerted"` if `alertedRemainingSec >= 60` (skipping restoration when `< 60s` so Cloudflare KV's 60-second minimum TTL floor never extends a sub-minute suppression window):
   ```bash
   REM_TTL=$(jq -r '.alertedRemainingSec' /tmp/sniper-kv-backup/recover-alerted.json)
   if [ "$REM_TTL" -ge 60 ]; then
     npx wrangler kv key put --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "alerted" "1" --ttl="$REM_TTL"
   else
     npx wrangler kv key delete --namespace-id=45cb5b16318f4534bce256f6d1fa9d5d --remote "alerted" || true
   fi
   ```

### Step 6.3 — `[PRODUCTION WRITE]` Deploy Path A Config (`SIGNAL_QUEUE` Unbound, `SignalQueueDO` & `v1` Retained)
```bash
cat << 'EOF' > /tmp/sniper-kv-backup/wrangler.path-a.toml
name = "sniper-relay"
main = "/workspaces/Sniper/Sniper/worker/index.js"
compatibility_date = "2026-10-01"
workers_dev = true

[[migrations]]
tag = "v1"
new_sqlite_classes = ["SignalQueueDO"]

[[kv_namespaces]]
binding = "KV"
id = "45cb5b16318f4534bce256f6d1fa9d5d"

[triggers]
crons = ["* * * * *"]
EOF

npx wrangler deploy --config /tmp/sniper-kv-backup/wrangler.path-a.toml
```

### Step 6.4 — `[READ-ONLY]` Verify Path A Rollback Health
```bash
curl -s -o /dev/null -w "Unauth /signals: %{http_code}\n" "$WORKER_URL/signals"
curl -fsS -H "x-key: $APP_KEY" "$WORKER_URL/signals?since=0"
```
*(Note: Once operating on Path A KV fallback, if new signals advance KV `seq`, re-enabling `SIGNAL_QUEUE` later will require either copying the newer KV state into DO or bumping the DO instance name because `migrated_from_kv = "1"` is already set in the original DO instance.)*

---

## 7. Path B Destructive Fallback Boundary (Excluded From Normal Rollback)

- **Path B (`tag = "v2"`, `deleted_classes = ["SignalQueueDO"]` with Checkpoint 4 `edd06db:worker/index.js`) is strictly excluded from the normal rollback procedure.**
- Because Path B permanently deletes the `SignalQueueDO` SQLite namespace and removes the hardened `handleWithKvFallback` logic, it must **never** be executed unless:
  1. Forward deployment (`v1`) was already applied on Cloudflare,
  2. State export and Path A KV restoration (`Steps 6.1–6.2`) have already been verified, and
  3. The operator provides **separate, explicit authorization** for destructive Durable Object deletion.
