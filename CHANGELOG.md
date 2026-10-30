# Changelog

All notable changes to `sniper-bot` are documented here.

## [2.0.0-checkpoint] - 2026-10-30

### Master Prompt v2 Quant & Research Pipeline
- **Phase 1 (Research & Threat Taxonomy)**: Authored `research/scam_taxonomy.md` covering mint/freeze authorities, Token-2022 extensions (`TransferFeeConfig`, `PermanentDelegate`, `TransferHook`, `DefaultAccountStateFrozen`), bundled Slot-0 launches, insider cluster distribution, honeypots, wash trading, and prompt injection in metadata. Evaluated 6 strategies in `research/strategies.md`.
- **Phase 2 (Judging Rubric & Ranking)**: Implemented 7-factor weighted scoring rubric in `research/ranking.md`. Approved Strategy 3 (4.35) and Strategy 6 (4.03). Rejected Genesis Snipe (0.78), Migration Snipe (2.13), Copy Trading (1.50), and Social Scraping (1.48). Checkpoint 1 approved.
- **Phase 3 (Architecture & Threat Model)**: Designed modular zero-dependency architecture in `docs/architecture.md` with 8 component specifications, TypeScript data schemas, failure-mode matrix, and comprehensive threat model. Zero external runtime dependencies justified in `docs/dependencies.md`. Checkpoint 2 approved.
- **Phase 4 (Implementation Realism & Sizing)**: Created `src/sizing.js` (Capped Fractional Kelly, Fixed Fraction, daily drawdown dampener) and `src/simulator.js` (constant-product bonding curve price impact, sandwich extraction, honeypot revert trapping, congestion modeling, string sanitization). Expanded zero-dependency test suite to 75 passing tests.
- **Phase 5 (Walk-Forward Backtesting & Validation)**: Implemented deterministic chronological walk-forward engine (`src/backtest.js`, `scripts/execute-backtest.js`) across 1,000 survivorship-free launches (Train 40% / Val 30% / Test 30%). Pre-registered $K = 9$ parameter variants with Bonferroni FWER control ($\alpha_{\text{adj}} = 0.0055$). Out-of-sample test results: Win Rate 31.03%, Expectancy +16.56%, Profit Factor 2.66, Sortino 1.05, MaxDD 0.81%, Rug Hit Rate 0.0% (vs 72.89% Naive Liquidity Baseline). Checkpoint 3 approved.
- **Phase 6 & 7 (Paper Mirror & Live-Readiness Gate)**: Audited live running paper trading mirror ($N=42$ closed trades). Concluded **NOT READY FOR LIVE TRADING** due to cold cycle paper expectancy (-9.88%) and 33.6s public webhook relay latency. Live execution remains physically disabled and hard-locked.
- **Phase 8 (Operational Hardening)**: Authored `strategy/final.config.json` (versioned config), `reports/final_report.md` (methodology, limitations, honest confidence statement), `ops/monitoring.md` (telemetry, pause conditions, re-validation cadence), `ops/capital_plan.md` (phased staging, legal/tax compliance, anti-auto-scale rules), and updated `docs/runbook.md` (secret rotation, incident response).

## [Unreleased] - 2026-10-29

### Safety Gate
- **Token-2022 Security**: Added `inspectMintExtensions` in `src/gate.js` to detect and reject dangerous Token-2022 extensions, including permanent delegates, transfer hooks, transfer fees, non-transferable flags, default account frozen states, pausable mints, and close authorities.
- **Unfunded Wallet Detection**: Fixed wallet classification where accounts with 0 SOL (`ownerInfo[i] === null`) were previously treated as program PDAs. Unfunded accounts are now recognized as system wallets, preventing creators from bypassing top-10 concentration limits via unfunded burner wallets.
- **Multi-Account Aggregation**: Aggregated token holdings by wallet owner address across the top 20 largest accounts so splitting tokens across multiple token accounts belonging to the same wallet does not evade concentration limits.

### Paper Trading Engine
- **Time-Stop Calibration**: Calibrated default `bandDown` to `15%` in `src/config.js`. With 5% entry slippage and 8% exit slippage, mark-to-market executable PnL begins at `-12.38%`. The adjusted band ensures flat, stagnant tokens accumulate sideways duration and exit at 180 seconds rather than lingering for 30 minutes.
- **Quote Retry for Unindexed Pairs**: Added a 2-second quote retry in `src/paper.js` before concluding `skip_noquote`, reducing survivorship bias caused by DexScreener's indexing latency on newly minted pairs.
- **Testability & Determinism**: Added optional dependency injection (`deps = {}`) to `openPaper`, `tick`, and `close`, and exported `resetPositions()` for deterministic unit testing and simulation.

### Cloudflare Worker & Mini App
- **Timing-Safe Auth Verification**: Added `timingSafeEqualString` for `x-key`, `authorization`, and Telegram Mini App HMAC hash comparison to prevent timing side-channel attacks.
- **Timestamp Hardening**: Added bounds checking for Telegram `initData` `auth_date` to reject timestamps from the future (> 300s) as well as stale sessions (> 24 hours).
- **Rule Sanitization Exports**: Exported `cleanRules` and `RULE_LIMITS` for isolated unit testing.

### Tooling & Verification
- **Zero-Dependency Test Suite**: Added 20 automated tests in `test/` using strictly Node's built-in `node:test` and `node:assert`:
  - `test/exit-rules.test.js`: Stop-loss, liquidity drop, max hold, take-profit half, trailing stop, and time-stop.
  - `test/stats.test.js`: Metrics computation, win rate, drawdown, lag percentiles, and corrupted log parsing.
  - `test/gate.test.js`: Revoked authorities, invalid mint parsing, Token-2022 extension safety, multi-account concentration, and unfunded wallet handling.
  - `test/worker.test.js`: Timing-safe equality, Telegram `initData` verification (valid, tampered, expired, future, wrong-user), webhook queue deduplication and overflow, polling pagination, kill switch, and watchdog alerting.
- **Zero-Network Simulation**: Added `scripts/simulate.js` executing end-to-end simulated trading across 4 scenarios with synthetic price feeds.
- **Scripts in package.json**: Added `npm test` and `npm run sim`.
