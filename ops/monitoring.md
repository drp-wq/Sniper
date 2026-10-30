# Operational Monitoring & Telemetry Specification (ops/monitoring.md)

> **Mandate**: Real-time observability, automated circuit breaker triggers, and scheduled re-validation to detect alpha decay.

---

## 1. Key Observability Metrics & Dashboards

The bot continuously records telemetry into `logs/paper.jsonl`, local SQLite, and the Telegram Mini App HUD:

| Metric Category | Specific Indicator | Target Baseline | Warning Threshold | Critical Alarm / Pause Threshold |
|---|---|---|---|---|
| **Latency** | Relay lag (mint block $\rightarrow$ bot ingestion) | $< 15,000\text{ms}$ | $> 30,000\text{ms}$ | $> 60,000\text{ms}$ (Signal marked stale) |
| **Safety Gate** | On-chain reject rate | $85\%–95\%$ | $< 70\%$ (Filter leak) | $> 99.5\%$ (Over-filtering / RPC issue) |
| **Execution** | Slippage deviation (fill vs screen quote) | $< 5.0\%$ | $> 6.5\%$ | $> 8.0\%$ (Transaction rejected) |
| **Drawdown** | Intraday cumulative paper loss | $< 15\%$ | $> 25\%$ (Size halved) | $\ge 50\%$ (Automated 24h Kill Switch) |
| **System** | Heartbeat write interval | $180\text{s}$ (3 min) | $> 360\text{s}$ | $> 720\text{s}$ (Dead-man's switch watchdog alert) |

---

## 2. Automated Pause & Emergency Conditions

1. **Local Disk `HALT` Trigger**:
   - Creating `/workspaces/Sniper/HALT` immediately instructs `src/main.js` to halt all new entries while continuing to monitor and exit active positions.
2. **Daily Loss Circuit Breaker**:
   - If cumulative daily realized paper loss reaches $-50\%$ of allocated equity, the Risk Guardian locks entry evaluation for the remainder of the UTC day.
3. **RPC Failure Backoff**:
   - Upon 3 consecutive RPC connection timeouts, the bot pauses new entries and applies exponential backoff ($500\text{ms} \rightarrow 30\text{s}$).

---

## 3. Weekly Strategy Re-Validation Schedule

Alpha decays rapidly in Solana meme markets as deployers modify scam techniques and MEV searchers optimize tip bidding.

- **Cadence**: Every Sunday at 00:00 UTC.
- **Protocol**:
  1. Export past 7 days of paper trades using `node src/report.js`.
  2. Compute rolling 7-day win rate, expectancy, and average payoff ratio ($b$).
  3. If rolling 7-day expectancy is negative for 2 consecutive weeks, pause the active variant and re-run parameter optimization on the latest dataset.
  4. Audit new Token-2022 extensions on Solana mainnet for emerging exploit vectors.

---

## 4. Rollback & Fail-Safe Procedures

If bot misbehavior or software regression is detected:
1. **Engage Kill Switch**:
   ```bash
   touch /workspaces/Sniper/HALT
   ```
2. **Stop Process Supervisor**:
   ```bash
   kill $(pgrep -f "run-24h.sh") $(pgrep -f "main.js")
   ```
3. **Rollback Git Commit**:
   ```bash
   git checkout HEAD~1 -- src/
   ```
4. **Verify Paper Recovery State**:
   Confirm `logs/positions.json` is clean and uncorrupted before restarting:
   ```bash
   node -e "import('./src/paper.js').then(m => console.log('Recovered:', m.loadPositions()))"
   ```
