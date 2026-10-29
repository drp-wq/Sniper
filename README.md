# sniper-bot (paper phase)

Zero-dependency Node (>=22.13.0) scanner + paper trader. No keys, no signing, no real trades.

Flow: Helius webhook -> Cloudflare Worker (SignalQueueDO SQLite Durable Object) -> phone/dashboard polls -> on-chain gate -> paper position -> exit rules -> logs/paper.jsonl

### Mobile Access & Telegram Mini App (TMA)
Zero sideloading or PC required. Compatible with **Google Advanced Protection** on Pixel 10 Pro XL:
- Configure Telegram Bot & Mini App: `npm run telegram:setup`
- Launch terminal inside Telegram with native haptics: message your bot or tap **🚀 Launch Sniper**
- Web/PWA Command Center: `npm run ui` (port 8787)

### Core Commands
- Run (Termux/Node): `cp .env.example .env && nano .env && ./run.sh`
- Test suite: `npm test`
- Report: `npm run report` (or `node src/report.js`)
- Halt new entries: `touch HALT` (or POST /halt?on=1 on the Worker, or send `/halt` in Telegram)
- Setup guide: see `docs/sniper-bot-paper-only-hardening-and-android-setup-guide.pdf`.
