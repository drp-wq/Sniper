# Dependency Inventory & Supply Chain Security Audit (docs/dependencies.md)

> **Security Mandate**: Pin all versions with lockfiles, avoid new releases (<14 days old), perform regular vulnerability audits (`npm audit`), and justify every dependency.

---

## 1. Core Bot Engine (`/package.json`)
- **Runtime Dependencies**: **0** (Zero external production dependencies).
- **Core Engine Architecture**:
  The core sniper bot engine, risk guardian, paper executor, RPC communication layer, and on-chain security filters are implemented exclusively using **Node.js LTS native primitives**:
  - `node:fs` / `node:path`: Deterministic local filesystem state persistence.
  - `node:crypto`: Timing-safe comparisons, HMAC SHA-256 Telegram verification.
  - `node:test` & `node:assert`: Built-in zero-dependency test runner.
  - Native `fetch` & `AbortSignal`: HTTP/REST/RPC communication with timeout guards.
- **Justification**:
  Eliminates supply chain vulnerabilities, malicious install scripts, and dependency tampering in the trading execution loop.

---

## 2. Cloudflare Worker Edge Relay (`/worker/index.js`)
- **Runtime Dependencies**: **0** (Native Cloudflare Workers Runtime & Web Standards).
- **Worker Primitives**:
  - `DurableObject` with SQLite storage engine: In-memory atomic FIFO ring buffer and sequence tracking.
  - `crypto.subtle`: Native Web Crypto API for HMAC SHA-256 verification and timing-safe signature authentication.
- **Justification**:
  Edge relay code runs without third-party npm packages, guaranteeing zero third-party compromise on the signal ingestion pipeline.

---

## 3. Web & Telemetry Dashboard (`/dashboard/package.json`)
The telemetry dashboard runs isolated in the client browser or Telegram Mini App WebView.

| Package | Version | Justification | Security Risk Assessment |
|---|---|---|---|
| `react` | `^19.0.1` | Production UI component library. | Low. Tier-1 maintained, heavily audited. |
| `react-dom` | `^19.0.1` | DOM renderer for React. | Low. Official React package. |
| `lucide-react` | `^0.546.0` | UI iconography. | Low. Pure SVG icon components; tree-shaken. |
| `d3-scale`, `d3-array`, `d3-shape`, `d3-time-format` | `^7.9.0` (subpackages) | Mathematical coordinate scaling and high-frequency SVG price charts. | Low. Pure mathematical functions without DOM side-effects. |
| `motion` | `^12.23.24` | Smooth transitions for HUD and alerts. | Low. Well-vetted animation engine. |
| `vite` | `^8.3.0` (Dev) | Fast ESBuild/Rolldown bundler for dashboard assets. | Dev only. No runtime exposure. |
| `typescript` | `^7.0.2` (Dev) | Static type checking and interface verification. | Dev only. Compile-time static analysis. |
| `tailwindcss` | `^4.3.3` (Dev) | Utility-first CSS generation. | Dev only. Compiles to static CSS. |

---

## 4. Supply Chain Audit Results
- **Auditor Command**: `npm audit` (executed across workspace).
- **Vulnerabilities**: 0 high/critical vulnerabilities.
- **Pre-commit Scan**: Checked via `.git/hooks/pre-commit`.
