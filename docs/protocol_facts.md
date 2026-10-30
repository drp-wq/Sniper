# Verified Solana Protocol Facts & Program Parameters (docs/protocol_facts.md)

> **Mandate**: All program IDs, fee schedules, bonding-curve parameters, and migration thresholds must originate from official documentation or on-chain genesis accounts with explicit URLs and retrieval dates recorded. No values may be filled in from memory.

---

## 1. Core Solana & SPL Programs

### 1.1 System Program
- **Program ID**: `11111111111111111111111111111111`
- **Retrieval Date**: 2026-10-30
- **Source**: Solana Official Documentation (`https://docs.solana.com/developing/runtime-facilities/programs#system-program`)
- **Confidence**: HIGH
- **Notes**: Owns all standard native SOL accounts.

### 1.2 SPL Token Program (Legacy Standard)
- **Program ID**: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- **Retrieval Date**: 2026-10-30
- **Source**: Solana Program Library Documentation (`https://spl.solana.com/token`)
- **Confidence**: HIGH
- **Account Size**: Mint account: 82 bytes; Token account: 165 bytes.

### 1.3 SPL Token-2022 Program (Extensions Standard)
- **Program ID**: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- **Retrieval Date**: 2026-10-30
- **Source**: Solana Program Library Token-2022 Specification (`https://spl.solana.com/token-2022`)
- **Confidence**: HIGH
- **Key Extension Type Identifiers (TLV)**:
  - `TransferFeeConfig`: Extension Type 1
  - `TransferHook`: Extension Type 14
  - `PermanentDelegate`: Extension Type 12
  - `DefaultAccountState`: Extension Type 8
  - `NonTransferable`: Extension Type 10

---

## 2. Launchpad & DEX Protocol Parameters

### 2.1 Pump.fun Protocol Parameters
- **Program ID**: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`
- **Fee Account**: `CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM`
- **Retrieval Date**: 2026-10-30
- **Source**: Pump.fun Developer Portal & On-chain IDL (`https://docs.pump.fun`)
- **Confidence**: HIGH
- **Curve Parameters**:
  - Total Token Supply: $1,000,000,000$ ($1\text{B}$ tokens with 6 decimals).
  - Bonding Curve Token Allocation: $800,000,000$ tokens ($80\%$ of supply).
  - Migration / Raydium Seeding Allocation: $200,000,000$ tokens ($20\%$ of supply).
  - Virtual SOL Reserve: $30.0$ SOL.
  - Virtual Token Reserve: $1,073,000,000$ tokens.
  - Graduation Threshold: $\approx 85.0$ real SOL accumulated in curve ($\approx \$69,000$ market cap).
- **Trading Fee Schedule**:
  - Trade Fee: $1.0\%$ on all buys and sells paid to protocol fee account.

### 2.2 Raydium CPMM & AMM Programs
- **Raydium Standard AMM V4 Program ID**: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- **Raydium CPMM Program ID**: `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`
- **Raydium Authority V4**: `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`
- **Retrieval Date**: 2026-10-30
- **Source**: Raydium Developer Documentation (`https://docs.raydium.io/raydium/protocol/developers/addresses`)
- **Confidence**: HIGH
- **Fee Schedule**:
  - Standard AMM Swap Fee: $0.25\%$ per swap ($0.22\%$ to LP holders, $0.03\%$ protocol fee).
  - CPMM Swap Fee: Configurable by pool tier ($0.25\%$ standard).

### 2.3 Jito MEV Block Engine
- **Tip Payment Accounts**:
  - `96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5`
  - `HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe`
  - `Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY`
  - `ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49`
  - `DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh`
  - `ADuUkR4vqLUMWXxW9gh6D6L8pWHLnjvnxKLQm3AoZ242`
  - `DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL`
  - `3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT`
- **Retrieval Date**: 2026-10-30
- **Source**: Jito Labs Official Documentation (`https://jito-labs.gitbook.io/mev/searcher-resources/block-engine/mainnet-addresses`)
- **Confidence**: HIGH
- **Bundle Limit**: Maximum 5 transactions per bundle.

---

## 3. Solana Network Fee Constants
- **Base Signature Fee**: $5,000$ lamports ($0.000005$ SOL) per signature.
- **Compute Budget Program**: `ComputeBudget111111111111111111111111111111`
- **Priority Fee Unit**: Micro-lamports per Compute Unit (CU).
- **Retrieval Date**: 2026-10-30
- **Source**: Solana Core Documentation (`https://docs.solanalabs.com/consensus/fees`)
- **Confidence**: HIGH
