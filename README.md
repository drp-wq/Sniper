# sniper-bot (paper phase)

Zero-dependency Node (>=22.13.0) scanner + paper trader. No keys, no signing, no real trades.

Flow: Helius webhook -> Cloudflare Worker (SignalQueueDO SQLite Durable Object) -> phone/dashboard polls -> on-chain gate -> paper position -> exit rules -> logs/paper.jsonl

Run (Termux): `cp .env.example .env && nano .env && ./run.sh`
Test suite: `npm test`
Report: `npm run report` (or `node src/report.js`)
Halt new entries: `touch HALT` (or POST /halt?on=1 on the Worker)
Setup guide: see `docs/sniper-bot-paper-only-hardening-and-android-setup-guide.pdf`.
