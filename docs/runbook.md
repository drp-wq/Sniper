# Solana Sniper Bot — Production Runbook & Operations Guide

## 1. Operational Overview & Safety Invariants

The **Solana Sniper Bot** is engineered strictly for **paper trading simulation, token screening, and telemetry monitoring**. It is designed from first principles with a **fail-closed** security architecture to prevent accidental financial exposure.

### Mandatory Safety Invariants
- `PAPER=true`: Paper trading execution only. No live wallet transactions or token swaps.
- `DRY_RUN=true`: Price execution is simulated against DexScreener quotes with pessimistic slippage model (+5% entry slippage, -8% exit slippage).
- `AUTO_EXECUTE=false`: Automated on-chain signing is disabled.
- `LIVE_TRADING_ENABLED=false`: No live Solana execution path exists anywhere in the codebase.
- **Zero Keypairs**: The repository and runtime contain zero private keys, seed phrases, or transaction signing capabilities.
- **Fail-Closed Configuration**: If any safety variable is missing, undefined, or set to a non-safe value (e.g. `LIVE_TRADING_ENABLED=true`), `assertPaperSafety(env)` halts the process immediately at startup.

---

## 2. System Architecture

```
                             +-------------------------+
                             |  Helius Solana Webhook  |
                             +------------+------------+
                                          | POST /hook
                                          v
+------------------------+   HTTP    +----+--------------------+
|   Telegram Mini App    | <=======> |   Cloudflare Worker     |
| (UI / Control Plane)   | /api/*    | (SignalQueue & KV State)|
+------------------------+           +----+--------------------+
                                          ^
                             GET /signals | POST /heartbeat
                                          v
                             +------------+------------+
                             |    Phone Execution Bot  |
                             |   (Node.js / Termux)    |
                             +------------+------------+
                                          |
                        +-----------------+-----------------+
                        |                                   |
                        v                                   v
             +----------+----------+             +----------+----------+
             |    Solana RPC Gate  |             |     RiskGuardian    |
             |   (Revoked Auth,    |             | (KillSwitch, Age,   |
             |    Top 10 Wallets)  |             |  Max Open, Limits)  |
             +---------------------+             +---------------------+
```

1. **Helius Webhook**: Delivers mint events to Worker `/hook` authenticated by `HELIUS_AUTH`.
2. **Cloudflare Worker**: Filters SOL/stables, deduplicates signals, caps queue (`QMAX=50`), and serves the Telegram Mini App at `/app`.
3. **Phone Bot (`src/main.js`)**: Polls Worker `/signals` every 3s via `./run.sh`, runs safety gates and RiskGuardian before entering paper positions.
4. **Safety Gate (`src/gate.js`)**: Checks revoked mint and freeze authorities via Solana JSON-RPC, screens for malicious Token-2022 extensions, and aggregates top-10 non-PDA wallet concentrations.
5. **RiskGuardian (`src/guardian.js`)**: Authoritative veto layer checking KillSwitch, signal freshness (<60s), max open positions (<=5), and daily paper loss limit (-50%).
6. **Watchdog (`worker/index.js scheduled()`)**: Dead-man's switch cron checking heartbeat every minute; alerts Telegram if phone bot is silent > 12 minutes.

---

## 3. Environment Configuration Checklist

### Phone Bot Environment (`.env`)
```bash
# Core Safety Settings (MANDATORY)
PAPER=true
DRY_RUN=true
AUTO_EXECUTE=false
LIVE_TRADING_ENABLED=false

# Worker Relay
WORKER_URL="https://sniper-relay.<account>.workers.dev"
APP_KEY="your-random-32-char-app-key"

# Solana RPC
RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY"

# Telegram Notifications (optional fallback)
TG_TOKEN="123456789:ABCDefgh..."
TG_CHAT="123456789"
```

### Cloudflare Worker Secrets (`wrangler secret put <NAME>`)
- `APP_KEY`: Shared secret authenticating phone bot requests (`/signals`, `/heartbeat`, `/export-kv`).
- `HELIUS_AUTH`: Webhook header secret verifying incoming Helius events (`/hook`).
- `TG_TOKEN`: Telegram Bot Token used for Mini App HMAC verification and alert dispatch.
- `TG_CHAT`: Telegram Chat ID for administrative and watchdog alert delivery.
- `TG_ADMINS`: Comma-delimited list of Telegram user IDs with full administrative privileges (rules mutation, emergency halt).
- `TG_OPERATORS`: Comma-delimited list of Telegram user IDs with operator privileges (emergency halt toggle).
- `TG_VIEWERS`: Comma-delimited list of Telegram user IDs with read-only access (`/api/state`, `/api/audit`).

---

## 4. Telegram Mini App & Control Plane

The Telegram Mini App is served directly by the Cloudflare Worker at `/app` or `/`.

### Role-Based Access Control (RBAC)
| Role | Endpoints Permitted | Capabilities |
|---|---|---|
| **Admin** | `/api/state`, `/api/audit`, `/api/halt`, `/api/rules` | Full control: toggle KillSwitch, update exit rules, view audit trail |
| **Operator** | `/api/state`, `/api/audit`, `/api/halt` | Operational control: toggle KillSwitch, view state and audit trail |
| **Viewer** | `/api/state`, `/api/audit` | Read-only observation of open paper positions, stats, and audit history |
| **Unknown** | None (HTTP 403 Forbidden) | Blocked from all `/api/*` routes |

### Replay & Tamper Protection
- Every `/api/*` call requires the Telegram WebApp init data string in the `x-init` header.
- The Worker validates the HMAC-SHA256 signature against `TG_TOKEN`.
- Mutations (`POST /api/halt`, `POST /api/rules`) enforce single-use replay detection with in-memory hash pruning.

---

## 5. Risk Management & Emergency KillSwitch

### Authoritative KillSwitch Engagement
To immediately stop all new paper entries across the entire system:
1. **Via Telegram Mini App**: Press the **Emergency Halt** button in the header (requires Operator or Admin role).
2. **Via Local File**: Create an empty file named `HALT` in the project root:
   ```bash
   touch HALT
   ```
3. **Via Worker API**:
   ```bash
   curl -X POST "https://sniper-relay.<account>.workers.dev/halt?on=1" -H "x-key: $APP_KEY"
   ```

### KillSwitch Behavior
- `RiskGuardian` immediately blocks all new entry signals (`reason: kill_switch_active`).
- Existing paper positions continue to be monitored for exit criteria (Stop Loss, Take Profit, Trailing Stop, Max Hold).
- Watchdog cron runs and phone recoveries **never** clear or reset an active `halt`.
- Clearing the KillSwitch requires an explicit resume action (`POST /api/halt?on=0` by an Operator or Admin, or removing the `HALT` file).

---

## 6. Verification & Test Suite

Run the following test commands before each deployment:

```bash
# 1. Full Node.js Test Suite (Gate, Rules, Worker, Auth, RBAC, Guardian)
npm test

# 2. Telegram Relay & Bot Token Verification
npm run test:telegram

# 3. End-to-End Paper Trading Simulation (Zero-Network)
npm run sim
```

All 41 unit and integration tests must pass with zero failures.

---

## 7. Incident Recovery & Rollback Runbook

### Scenario A: Phone Bot Stops Reporting (Watchdog Silent Alert)
1. Telegram sends alert: `Phone silent for 15 min. Open paper positions: N`.
2. Check Termux/Android terminal:
   ```bash
   ps aux | grep node
   tail -n 100 logs/paper.jsonl
   ```
3. Restart process via `./run.sh`. Watchdog automatically detects recovered heartbeat and clears alert counter.

### Scenario B: Unexpected Exit Rule Behavior
1. Check Worker audit trail:
   ```bash
   curl -s "https://sniper-relay.<account>.workers.dev/api/audit" -H "x-init: <admin-initData>"
   ```
2. Reset rules via Telegram Mini App Settings tab or POST to `/api/rules`.
3. If necessary, engage emergency KillSwitch (`touch HALT`).

### Scenario C: Clean Codebase Rollback
To revert working tree to baseline without affecting paper logs:
```bash
git checkout HEAD -- src/ worker/ dashboard/
npm test
```
