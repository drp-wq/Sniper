# sniper-bot (paper phase)

Zero-dependency Node (>=18) scanner and paper trader with a Telegram Mini App control panel.
No private keys, no wallet signing, no real transactions.

## Pipeline Architecture
- **Solana Webhooks**: Helius Enhanced Webhook streams transactions to Cloudflare Worker `/hook`.
- **Worker & KV Queue**: Ingests, filters out SOL/stables, deduplicates mints, and maintains FIFO signal queue in KV. Serves Telegram Mini App at `/app`.
- **Phone Bot (Android / Termux)**: Polls `/signals` every 3s via `./run.sh`, updates heartbeat every 3m.
- **Safety Gate (`src/gate.js`)**: Verifies revoked mint and freeze authorities via Solana JSON-RPC, checks for malicious Token-2022 extensions (transfer hooks, permanent delegates, transfer fees), and aggregates top-10 wallet concentration (excluding program PDAs while properly identifying unfunded system wallets).
- **Paper Execution Engine (`src/paper.js`)**: Applies pessimistic 5% entry and 8% exit slippage, evaluating DexScreener quotes against:
  - Stop-loss (`-25%`)
  - Take-profit half (`+100%`)
  - Trailing stop (`-20%` from peak once armed at `+50%`)
  - Sideways time-stop (`180s` in calibrated band)
  - Liquidity drop (`-30%` from entry)
  - Max hold duration (`30m`)
  - Missing quote timeout (`12` ticks)
- **Logging & Telemetry**: JSON lines recorded to `logs/paper.jsonl`, summarized via `src/stats.js`.

<<<<<<< HEAD
## Getting Started

### Local Tests (Zero Dependencies)
Run the test suite using Node's built-in `node:test` runner (covers exit-rule engine, stats calculation, safety gate logic with mock RPC, and Worker authentication/queueing/watchdog):
```bash
npm test
```

### Local Simulation (Zero Network)
Simulate end-to-end bot execution against a mocked Worker with synthetic price feeds (runner with take-profit and trailing stop, stop-loss dump, liquidity rug, and sideways stall):
```bash
npm run sim
```

### Termux Setup & Execution
1. Install Termux and dependencies:
   ```bash
   pkg update && pkg install nodejs-lts git tmux
   ```
2. Configure `.env` on Android device only:
   ```bash
   cp .env.example .env && nano .env
   ```
3. Start the bot:
   ```bash
   ./run.sh
   ```
4. Generate paper trading performance report:
   ```bash
   node src/report.js
   ```

## Control Panel & Kill Switch
- **Telegram Mini App**: Configure Menu Button in `@BotFather` to `https://<YOUR_WORKER_URL>/app`.
- **Remote Kill Switch**: Click Halt in the Mini App, or call `curl -X POST "https://<YOUR_WORKER_URL>/halt?on=1" -H "x-key: $APP_KEY"`.
- **Local Kill Switch**: `touch HALT` inside the project root on the phone.
=======
Run (Termux): `cp .env.example .env && nano .env && ./run.sh`
Test suite: `npm test`
Report: `npm run report` (or `node src/report.js`)
Telegram test: `npm run test:telegram` (or `node scripts/verify-telegram.js`)
Halt new entries: `touch HALT` (or POST /halt?on=1 on the Worker)
Setup guide: see `docs/sniper-bot-paper-only-hardening-and-android-setup-guide.pdf`.

## Telegram Setup (Alerts & Heartbeat Watchdog)

The bot sends real-time Telegram notifications for:
- Paper Buy entries (with entry price and liquidity)
- Paper Exit fills (reason, PnL %, and hold duration)
- Trailing stop arming & take-profit milestones
- Unresolved position timeouts
- Worker kill switch triggers (`HALT set` / `HALT cleared`)
- Worker dead-man watchdog alerts (if phone is silent >12 min)

### 1. Create Bot & Obtain Chat ID
1. On Telegram, message **@BotFather** -> send `/newbot` -> copy the HTTP API token (`TG_TOKEN`).
2. Open your new bot and click **START** (or send `/start`).
3. Message **@userinfobot** to get your numeric ID (`TG_CHAT`).

### 2. Configure Credentials
- **On Phone (.env)**:
  ```bash
  echo "TG_TOKEN=your_bot_token" >> .env
  echo "TG_CHAT=your_chat_id" >> .env
  ```
- **On Cloudflare Worker (optional, for watchdog alerts & relay)**:
  ```bash
  npx wrangler secret put TG_TOKEN
  npx wrangler secret put TG_CHAT
  ```

### 3. Verify Telegram Setup
Run the verification utility:
```bash
npm run test:telegram
```
>>>>>>> 48de9de (wip)
