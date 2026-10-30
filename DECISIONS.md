# Architecture, Research & Strategy Decision Log (DECISIONS.md)

This log documents major architectural, research, risk management, and quantitative decisions made across the Solana Meme Coin Sniper lifecycle.

---

## Decision 001: Strict Phased Execution with Explicit Checkpoint Gates
- **Date**: 2026-10-30
- **Context**: Autonomous bot development risks premature capital exposure or implementing unvetted strategies based on vendor hype.
- **Decision**: Strictly enforce Phase 1 (Research) $\rightarrow$ Phase 2 (Judging Rubric & Ranking) $\rightarrow$ Checkpoint 1 Stop $\rightarrow$ Phase 3 (Architecture & Threat Model) $\rightarrow$ Checkpoint 2 Stop $\rightarrow$ Phase 4 (Implementation) $\rightarrow$ Phase 5 (Rigorous Backtest & Validation) $\rightarrow$ Checkpoint 3 Stop $\rightarrow$ Phase 6 (Paper Trading) $\rightarrow$ Phase 7 (Live-Readiness Gate) $\rightarrow$ Checkpoint 4 Stop $\rightarrow$ Phase 8 (Operational Outputs).
- **Rationale**: Capital survival takes absolute precedence. "No viable edge found" is a valid, acceptable outcome.

## Decision 002: Hard Security & Isolation Constraints
- **Date**: 2026-10-30
- **Context**: Solana bot ecosystems are heavily targeted by supply-chain attacks, fake popularity repos, malicious Token-2022 extensions, and prompt injection in token metadata.
- **Decision**:
  1. Default simulation only; live mode locked behind explicit compile/runtime flag plus interactive confirmation.
  2. Zero secrets committed or logged; dedicated burner wallet only if live gate passes; secret scanning pre-commit hook installed.
  3. All external data (metadata, tweets, web content) treated as untrusted DATA, never executable instructions.
  4. Pre-vetted dependencies with pinned versions and audit justification.

## Decision 003: Source Weighting and Evidence Standards
- **Date**: 2026-10-30
- **Context**: Vendor YouTube videos and bot sales blogs claim 80-90% win rates on meme snipes without transaction cost or survivorship accounting.
- **Decision**: Weight vendor claims LOW (mark UNVERIFIED unless reproducible data is supplied). Weight academic papers, Dune on-chain analytics, official Solana/Jito docs, and security audits HIGH.

## Decision 004: Strategy Evaluation & Selection (Phase 1 & Phase 2)
- **Date**: 2026-10-30
- **Context**: Evaluated 6 Solana meme coin sniping strategies using a 7-factor weighted rubric with a 3.50/5.00 pass cutoff.
- **Decision**: 
  - Approved Strategy 3 (Calibrated Quality Gate & Delayed Momentum, Score: 4.35) as primary architecture.
  - Approved Strategy 6 (Post-Survival Breakout, Score: 4.03) as secondary liquidity-health filter.
  - Rejected Strategy 1 (Genesis Block-0, Score: 0.78), Strategy 2 (Raydium Migration, Score: 2.13), Strategy 4 (Copy-Trading, Score: 1.50), and Strategy 5 (Social Scraping, Score: 1.48) due to structural unprofitability, high insider clustering, and negative latency expectancy on commodity infrastructure.
- **Rationale**: Prioritize capital safety, verifiable on-chain scam rejection, and mathematical trade management over low-latency physical MEV races.

## Decision 005: System Architecture & Threat Model (Phase 3)
- **Date**: 2026-10-30
- **Context**: Design modular, testable pipeline for Strategy 3 with zero-dependency core execution, strict fail-closed safety, and robust threat defense.
- **Decision**:
  1. Language: TypeScript/Node.js LTS using zero external npm runtime dependencies for the core trading engine, eliminating supply-chain attack vectors.
  2. Ingestion: Dual-mode `SignalProvider` supporting live WebSockets/webhooks and deterministic historical replay without lookahead bias.
  3. Safety: Fail-closed sequence covering mint/freeze authorities, Token-2022 extensions, top-10 concentration (<25%), dev balance (<5%), and initial liquidity sanity (>=$15k).
  4. Position Management: Asymmetric exit ladder (-25% hard stop, 50% TP banking at +100% with auto-breakeven ratchet, dynamic trailing stop tightens to 15% on 2x and 10% on 3x+, accelerated liquidity-drop exit at >=20%).
  5. Threat Model: Hardened against key theft, RPC poisoning, prompt injection in token metadata, dependency compromise, and Mini App replay attacks.
- **Rationale**: Maximize capital survival, auditability, and execution reliability under commodity $0 budget constraints.

## Decision 006: Implementation Realism & Backtest Validation (Phase 4 & Phase 5)
- **Date**: 2026-10-30
- **Context**: Implement sizing, simulation realism, and execute chronological walk-forward backtest (Train 40% / Val 30% / Test 30%) across 1,000 survivorship-free tokens.
- **Decision**:
  1. Built `src/sizing.js` (Capped Kelly & Fixed Fraction with daily drawdown dampening) and `src/simulator.js` (bonding curve price impact, sandwich extraction, honeypot revert modeling, string sanitization).
  2. Pre-registered $K = 9$ discrete parameter variants on Validation partition, controlling FWER with Bonferroni correction ($\alpha_{\text{adj}} = 0.0055$).
  3. Identified optimal calibrated parameter set `P5_SL20_TP100` (SL: -20%, TP1: +100%, TrailArm: +40%, Trail: 20%).
  4. Out-of-sample test results (300 unseen tokens):
     - Strategy 3: Win Rate 31.03%, Expectancy +16.56%, Profit Factor 2.66, Sortino 1.05, MaxDD 0.81%, Rug Hit Rate 0.0%.
     - Baseline A (Random Entry): Win Rate 3.75%, Expectancy -50.76%, MaxDD 40.86%, Rug Hit Rate 62.5%.
     - Baseline B (Naive Liquidity): Win Rate 3.66%, Expectancy -55.65%, MaxDD 152.84%, Rug Hit Rate 72.89%.
  5. Statistical Integrity Statement: Sample size ($N = 29$ trades from 300 unseen launches) indicates strong directional edge over naive baselines, but remains inconclusive for full live deployment without $N \ge 150-200$ paper validation trades.
- **Rationale**: Strict honesty in quantitative validation; avoid false claims of instant riches; require empirical paper mirror verification.

## Decision 007: Phase 7 Live-Readiness Gate Evaluation & Phase 8 Operational Hardening
- **Date**: 2026-10-30
- **Context**: Evaluate all Phase 7 criteria against real-time paper mirror performance ($N = 42$ closed trades) and out-of-sample backtest metrics.
- **Decision**:
  1. Verdict: **NOT READY FOR LIVE TRADING**. Live execution remains physically disabled; system continues strictly in paper trading mode.
  2. Rationale: Gate Criterion 1 (Positive expectancy in paper trading) and Criterion 5 (Paper-vs-backtest gap) failed. Live paper expectancy is currently negative (-9.88% mean PnL, 4.8% win rate) due to cold cycle dynamics on live Solana meme coins and a median 33.6s relay latency over public webhooks.
  3. Safety Success: 0.0% rug/honeypot hit rate achieved across both backtesting and live paper trading, proving the security filters function as intended.
  4. Final Outputs Created: `strategy/final.config.json` (versioned config), `reports/final_report.md` (methodology, limitations, honest confidence statement), `ops/monitoring.md` (telemetry, pause conditions, re-validation cadence), `ops/capital_plan.md` (phased staging, legal/tax compliance, anti-auto-scale rules), and `docs/runbook.md` (secret rotation, incident response).




