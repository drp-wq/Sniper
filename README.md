# sniper-bot (paper phase)

Zero-dependency Node (>=18) scanner + paper trader. No keys, no signing, no real trades.

Flow: Helius webhook -> Cloudflare Worker (KV) -> phone polls -> gate -> paper position -> exit rules -> logs/paper.jsonl

Run (Termux): `cp .env.example .env && nano .env && ./run.sh`
Report: `node src/report.js`
Halt new entries: `touch HALT` (or POST /halt?on=1 on the Worker)
Setup guide: see the PDF.
