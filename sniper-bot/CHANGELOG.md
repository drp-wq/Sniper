# Changelog

All notable changes to `sniper-bot` are documented here.

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
