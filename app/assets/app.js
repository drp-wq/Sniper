(() => {
  const SYSTEM_PROGRAM = "11111111111111111111111111111111";
  const DEFAULT_WORKER_URL = "https://sniper-relay.pjdebnath01.workers.dev";
  const STORAGE_KEY_CFG = "sniper_paper_cfg_v1";
  const STORAGE_KEY_STATE = "sniper_paper_state_v1";

  const hasAndroidBridge = () =>
    typeof window !== "undefined" &&
    window.AndroidBridge &&
    typeof window.AndroidBridge.httpRequest === "function";

  let hasLocalNodeApi = false;
  let loopRunning = false;
  let pollTimer = null;
  let tickTimer = null;

  const state = {
    cfg: {
      workerUrl: DEFAULT_WORKER_URL,
      appKey: "",
      rpcUrl: "",
      pollMs: 3000,
      priceMs: 5000,
      maxOpen: 5,
      minLiqUsd: 15000,
      maxTop10Pct: 35,
      entrySlip: 0.05,
      exitSlip: 0.08,
      maxSignalAgeMs: 60000,
    },
    workerOnline: false,
    workerLatencyMs: null,
    remoteHalt: false,
    localHalt: false,
    seq: 0,
    oldestId: null,
    since: 0,
    hb: null,
    openPositions: [],
    archivedPositions: [],
    events: [],
    signalsFeed: [],
    seenKeys: [],
  };

  function showToast(msg) {
    const el = document.getElementById("toastMsg");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function redactText(str) {
    let out = String(str ?? "");
    out = out.replace(/([?&](?:api[-_]?key|key|token|auth|secret)=)[^&\s"'<>]+/gi, "$1[REDACTED]");
    if (state.cfg.appKey && state.cfg.appKey.length >= 4) {
      out = out.split(state.cfg.appKey).join("[REDACTED]");
    }
    return out.slice(0, 260);
  }

  function loadPersistedConfig() {
    try {
      let raw = null;
      if (hasAndroidBridge() && typeof window.AndroidBridge.loadConfig === "function") {
        raw = window.AndroidBridge.loadConfig();
      }
      if (!raw) {
        raw = localStorage.getItem(STORAGE_KEY_CFG);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        state.cfg = { ...state.cfg, ...parsed };
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  function savePersistedConfig() {
    const raw = JSON.stringify(state.cfg);
    try {
      localStorage.setItem(STORAGE_KEY_CFG, raw);
      if (hasAndroidBridge() && typeof window.AndroidBridge.saveConfig === "function") {
        window.AndroidBridge.saveConfig(raw);
      }
    } catch {
      /* ignore storage errors */
    }
  }

  function loadPersistedState() {
    try {
      let raw = null;
      if (hasAndroidBridge() && typeof window.AndroidBridge.loadState === "function") {
        raw = window.AndroidBridge.loadState();
      }
      if (!raw) {
        raw = localStorage.getItem(STORAGE_KEY_STATE);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.openPositions)) state.openPositions = parsed.openPositions;
        if (Array.isArray(parsed.archivedPositions)) state.archivedPositions = parsed.archivedPositions;
        if (Array.isArray(parsed.events)) state.events = parsed.events.slice(-500);
        if (Array.isArray(parsed.seenKeys)) state.seenKeys = parsed.seenKeys.slice(-500);
        if (Number.isFinite(Number(parsed.since))) state.since = Number(parsed.since);
        if (typeof parsed.localHalt === "boolean") state.localHalt = parsed.localHalt;
      }
    } catch {
      /* ignore */
    }
  }

  function savePersistedState() {
    const raw = JSON.stringify({
      since: state.since,
      localHalt: state.localHalt,
      openPositions: state.openPositions,
      archivedPositions: state.archivedPositions.slice(-200),
      events: state.events.slice(-500),
      seenKeys: state.seenKeys.slice(-500),
    });
    try {
      localStorage.setItem(STORAGE_KEY_STATE, raw);
      if (hasAndroidBridge() && typeof window.AndroidBridge.saveState === "function") {
        window.AndroidBridge.saveState(raw);
      }
    } catch {
      /* ignore */
    }
  }

  function recordEvent(ev, data = {}) {
    const entry = { ts: new Date().toISOString(), ev, ...data };
    state.events.push(entry);
    if (state.events.length > 500) state.events.shift();
    savePersistedState();
    renderAll();
    return entry;
  }

  // Unified HTTP client: uses AndroidBridge inside APK, local Node proxy when available, or standard fetch
  async function httpJson(url, { method = "GET", headers = {}, body = null } = {}) {
    const started = Date.now();
    if (hasAndroidBridge()) {
      const rawRes = window.AndroidBridge.httpRequest(
        url,
        method,
        JSON.stringify(headers),
        body ? (typeof body === "string" ? body : JSON.stringify(body)) : ""
      );
      const parsed = JSON.parse(rawRes);
      const latencyMs = Date.now() - started;
      if (!parsed.ok && parsed.error) {
        throw new Error(redactText(parsed.error));
      }
      let jsonBody = null;
      try {
        jsonBody = JSON.parse(parsed.body);
      } catch {
        jsonBody = null;
      }
      return {
        ok: parsed.status >= 200 && parsed.status < 300,
        status: parsed.status,
        data: jsonBody,
        latencyMs,
      };
    }

    if (hasLocalNodeApi) {
      const r = await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          method,
          headers,
          body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : null,
        }),
      });
      const j = await r.json();
      if (j.error) throw new Error(redactText(j.error));
      return {
        ok: j.status >= 200 && j.status < 300,
        status: j.status,
        data: j.data,
        latencyMs: j.latencyMs ?? (Date.now() - started),
      };
    }

    const r = await fetch(url, {
      method,
      headers,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const latencyMs = Date.now() - started;
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data, latencyMs };
  }

  // Solana JSON-RPC helper
  let rpcSeq = 0;
  async function solanaRpc(method, params = []) {
    const rpcUrl = state.cfg.rpcUrl || "__SERVER_ENV_RPC_URL__";
    const res = await httpJson(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: { jsonrpc: "2.0", id: ++rpcSeq, method, params },
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    if (!res.data || typeof res.data !== "object") throw new Error(`${method}: invalid JSON-RPC`);
    if (res.data.error) throw new Error(`${method}: ${redactText(res.data.error.message || "RPC error")}`);
    return res.data.result;
  }

  // Exact Token-2022 + SPL Mint Safety Gate matching src/gate.js
  function inspectMintExtensions(info) {
    const reasons = [];
    if (!info || typeof info !== "object") return reasons;
    if (info.isInitialized === false) reasons.push("mint not initialized");

    const hasAuth = (v) => typeof v === "string" && v.trim().length > 0;
    const extensions = Array.isArray(info.extensions) ? info.extensions : [];
    for (const ext of extensions) {
      const name = typeof ext?.extension === "string" ? ext.extension.trim() : "";
      const st = ext?.state && typeof ext.state === "object" ? ext.state : {};
      if (name === "permanentDelegate" && hasAuth(st.delegate)) {
        reasons.push("permanent delegate active");
      } else if (name === "transferHook" && (hasAuth(st.programId) || hasAuth(st.authority))) {
        reasons.push("transfer hook active");
      } else if (name === "transferFeeConfig") {
        const olderBps = Number(st?.olderTransferFee?.transferFeeBasisPoints ?? 0);
        const newerBps = Number(st?.newerTransferFee?.transferFeeBasisPoints ?? 0);
        if (
          olderBps > 0 ||
          newerBps > 0 ||
          hasAuth(st.transferFeeConfigAuthority) ||
          hasAuth(st.withdrawWithheldAuthority)
        ) {
          reasons.push("transfer fee active");
        }
      } else if (name === "defaultAccountState") {
        if (String(st.state ?? st.accountState ?? "").trim().toLowerCase() === "frozen") {
          reasons.push("default account state frozen");
        }
      } else if (name === "nonTransferable") {
        reasons.push("non-transferable mint");
      } else if ((name === "mintCloseAuthority" || name === "closeAuthority") && hasAuth(st.closeAuthority)) {
        reasons.push("mint close authority active");
      } else if ((name === "pausable" || name === "pausableConfig") && (Boolean(st.paused) || hasAuth(st.authority))) {
        reasons.push("pausable mint active");
      }
    }
    return [...new Set(reasons)];
  }

  async function runOnChainGate(mint) {
    const reasons = [];
    if (!mint || typeof mint !== "string") {
      return { pass: false, reasons: ["invalid mint address"], top10Pct: null };
    }
    const acc = await solanaRpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
    const info = acc?.value?.data?.parsed?.info;
    if (!info || !Number.isFinite(Number(info.decimals))) {
      return { pass: false, reasons: ["not a parsed SPL mint"], top10Pct: null };
    }
    if (info.mintAuthority) reasons.push("mint authority not revoked");
    if (info.freezeAuthority) reasons.push("freeze authority not revoked");
    for (const r of inspectMintExtensions(info)) reasons.push(r);

    const supply = Number((await solanaRpc("getTokenSupply", [mint]))?.value?.uiAmount ?? 0);
    if (!Number.isFinite(supply) || supply <= 0) {
      reasons.push("invalid or zero token supply");
      return { pass: false, reasons, top10Pct: 100 };
    }

    const largest = ((await solanaRpc("getTokenLargestAccounts", [mint]))?.value ?? []).slice(0, 20);
    const tokenAccs = largest.length
      ? (await solanaRpc("getMultipleAccounts", [largest.map((a) => a.address), { encoding: "jsonParsed" }]))?.value ?? []
      : [];
    const owners = tokenAccs.map((a) => a?.data?.parsed?.info?.owner ?? null);
    const ownerKeys = [...new Set(owners.filter(Boolean))];
    const ownerInfo = ownerKeys.length
      ? (await solanaRpc("getMultipleAccounts", [ownerKeys, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]))?.value ?? []
      : [];
    const isWallet = new Map(
      ownerKeys.map((k, i) => {
        const acct = ownerInfo[i];
        return [k, acct === null || acct === undefined || acct?.owner === SYSTEM_PROGRAM];
      })
    );

    const byOwner = new Map();
    for (let i = 0; i < largest.length; i++) {
      const owner = owners[i];
      if (!owner || isWallet.get(owner) !== true) continue;
      const amt = Number(largest[i]?.uiAmount ?? 0);
      if (Number.isFinite(amt) && amt > 0) {
        byOwner.set(owner, (byOwner.get(owner) ?? 0) + amt);
      }
    }

    const top10Amounts = [...byOwner.values()].sort((a, b) => b - a).slice(0, 10);
    const top10Pct = Number(((top10Amounts.reduce((s, a) => s + a, 0) / supply) * 100).toFixed(1));
    if (top10Pct > state.cfg.maxTop10Pct) {
      reasons.push(`top10 wallets hold ${top10Pct.toFixed(1)}% (> ${state.cfg.maxTop10Pct}%)`);
    }
    return { pass: reasons.length === 0, reasons, top10Pct, decimals: Number(info.decimals), supply };
  }

  // DexScreener quote matching src/price.js (validates baseToken.address === mint)
  async function fetchDexQuote(mint, preferredPair = null) {
    const res = await httpJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`);
    if (!res.ok || !res.data) return null;
    const pairs = Array.isArray(res.data.pairs) ? res.data.pairs : [];
    const valid = pairs.filter((p) => {
      if (
        !p ||
        p.chainId !== "solana" ||
        !Number.isFinite(Number(p.priceUsd)) ||
        Number(p.priceUsd) <= 0 ||
        !Number.isFinite(Number(p.liquidity?.usd ?? 0)) ||
        Number(p.liquidity?.usd ?? 0) < 0
      ) {
        return false;
      }
      const baseAddr = typeof p.baseToken?.address === "string" ? p.baseToken.address.trim() : "";
      if (mint && baseAddr && baseAddr !== mint) return false;
      return true;
    });
    if (!valid.length) return null;
    valid.sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
    let chosen = valid[0];
    let pairSwitched = false;
    if (preferredPair) {
      const m = valid.find((p) => p.pairAddress === preferredPair);
      if (m) chosen = m;
      else pairSwitched = true;
    }
    return {
      price: Number(chosen.priceUsd),
      liqUsd: Number(chosen.liquidity?.usd ?? 0),
      pair: chosen.pairAddress ?? null,
      symbol: chosen.baseToken?.symbol ?? null,
      dexId: chosen.dexId ?? null,
      pairSwitched,
    };
  }

  // Open Paper Position matching src/paper.js
  async function openPaperPosition(mint, sig = null, meta = {}) {
    if (state.localHalt || state.remoteHalt) {
      recordEvent("halted_skip", { mint, reason: "halt_active" });
      showToast("Skipped: HALT is active");
      return false;
    }
    if (state.openPositions.some((p) => p.mint === mint)) {
      recordEvent("signal_skip", { mint, reason: "position_already_open" });
      showToast("Position already open for this mint");
      return false;
    }
    if (state.openPositions.length >= state.cfg.maxOpen) {
      recordEvent("skip_maxopen", { mint });
      showToast(`MAX_OPEN (${state.cfg.maxOpen}) reached`);
      return false;
    }

    const q = await fetchDexQuote(mint);
    if (!q) {
      recordEvent("skip_noquote", { mint });
      showToast("No valid Solana quote on DexScreener");
      return false;
    }
    if (q.liqUsd < state.cfg.minLiqUsd) {
      recordEvent("skip_liquidity", { mint, liqUsd: q.liqUsd });
      showToast(`Liquidity $${Math.round(q.liqUsd)} < $${state.cfg.minLiqUsd}`);
      return false;
    }

    const now = Date.now();
    const entry = q.price * (1 + state.cfg.entrySlip);
    const pos = {
      mint,
      symbol: q.symbol || mint.slice(0, 6),
      sig,
      entry,
      rawEntryQuote: q.price,
      entrySlip: state.cfg.entrySlip,
      peak: entry,
      openedAt: now,
      liq0: q.liqUsd,
      pair: q.pair,
      sidewaysSince: null,
      trailArmed: false,
      tookHalf: false,
      halfRawPrice: null,
      realized: 0,
      misses: 0,
      missingSince: null,
      unresolvedMissingQuote: false,
      lastQuotePrice: q.price,
      lastExecPrice: q.price * (1 - state.cfg.exitSlip),
      lastLiqUsd: q.liqUsd,
      lastQuoteAt: now,
      ...meta,
    };
    state.openPositions.push(pos);
    recordEvent("paper_open", {
      mint,
      sig,
      entry,
      rawEntryQuote: q.price,
      entrySlip: state.cfg.entrySlip,
      liqUsd: q.liqUsd,
      pair: q.pair,
    });
    showToast(`PAPER BUY ${pos.symbol} @ $${entry.toExponential(3)}`);
    return true;
  }

  function compute2xSlipPnl(p, rawExitQuote) {
    if (!Number.isFinite(p.rawEntryQuote) || p.rawEntryQuote <= 0 || !Number.isFinite(rawExitQuote) || rawExitQuote <= 0) {
      return null;
    }
    const entry2x = p.rawEntryQuote * (1 + Math.min(0.99, state.cfg.entrySlip * 2));
    const exitFactor2x = Math.max(0.01, 1 - state.cfg.exitSlip * 2);
    const exitPx2x = rawExitQuote * exitFactor2x;
    const finalPct2x = (exitPx2x / entry2x - 1) * 100;
    if (p.tookHalf && Number.isFinite(p.halfRawPrice) && p.halfRawPrice > 0) {
      const halfPx2x = p.halfRawPrice * exitFactor2x;
      const halfPct2x = (halfPx2x / entry2x - 1) * 100;
      return Number((0.5 * halfPct2x + 0.5 * finalPct2x).toFixed(2));
    }
    return Number(finalPct2x.toFixed(2));
  }

  function closePaperPosition(mint, reason = "manual_paper_close", qOverride = null) {
    const idx = state.openPositions.findIndex((p) => p.mint === mint);
    if (idx === -1) return;
    const p = state.openPositions[idx];
    const rawExit = qOverride?.price ?? p.lastQuotePrice ?? p.rawEntryQuote;
    const px = rawExit * (1 - state.cfg.exitSlip);
    const pct = (px / p.entry - 1) * 100;
    const weight = p.tookHalf ? 0.5 : 1;
    const pnl = Number((p.realized + weight * pct).toFixed(2));
    const pnl2xSlip = compute2xSlipPnl(p, rawExit);
    const heldSec = Math.round((Date.now() - p.openedAt) / 1000);

    state.openPositions.splice(idx, 1);
    recordEvent("paper_close", {
      mint: p.mint,
      sig: p.sig,
      reason,
      pnl,
      ...(pnl2xSlip !== null ? { pnl2xSlip } : {}),
      heldSec,
      entry: p.entry,
      exitPrice: px,
      rawEntryQuote: p.rawEntryQuote,
      rawExitQuote: rawExit,
      liqUsd: qOverride?.liqUsd ?? p.lastLiqUsd,
      pair: p.pair,
    });
    showToast(`PAPER EXIT ${p.symbol || p.mint.slice(0, 6)}: ${reason} (${pnl >= 0 ? "+" : ""}${pnl}%)`);
  }

  // Price tick evaluation matching src/paper.js
  async function tickPricesNow() {
    if (!state.openPositions.length) {
      showToast("No open positions to tick");
      return;
    }
    const now = Date.now();
    for (const p of [...state.openPositions]) {
      const q = await fetchDexQuote(p.mint, p.pair).catch(() => null);
      if (!q || !Number.isFinite(q.price) || q.price <= 0) {
        p.misses = (p.misses || 0) + 1;
        p.missingSince = p.missingSince || now;
        if (p.misses >= 12 && !p.unresolvedMissingQuote) {
          p.unresolvedMissingQuote = true;
          recordEvent("paper_unresolved", {
            mint: p.mint,
            reason: "missing_quote_threshold",
            misses: p.misses,
            missingSince: p.missingSince,
          });
        }
        if (p.unresolvedMissingQuote && now - p.missingSince >= 30 * 60000) {
          state.openPositions = state.openPositions.filter((x) => x.mint !== p.mint);
          const missingDurationSec = Math.round((now - p.missingSince) / 1000);
          state.archivedPositions.push({ ...p, archivedAt: now, missingDurationSec });
          recordEvent("paper_archived_unresolved", {
            mint: p.mint,
            reason: "missing_quote_timeout",
            misses: p.misses,
            missingDurationSec,
            tookHalf: Boolean(p.tookHalf),
            realizedBankedPct: Number((p.realized || 0).toFixed(2)),
          });
        }
        continue;
      }

      if (p.unresolvedMissingQuote) {
        recordEvent("paper_quote_recovered", {
          mint: p.mint,
          missesBeforeRecovery: p.misses,
          price: q.price,
          liqUsd: q.liqUsd,
        });
      }
      p.misses = 0;
      p.missingSince = null;
      p.unresolvedMissingQuote = false;
      p.lastQuotePrice = q.price;
      p.lastExecPrice = q.price * (1 - state.cfg.exitSlip);
      p.lastLiqUsd = q.liqUsd;
      p.lastQuoteAt = now;

      const px = p.lastExecPrice;
      const pct = (px / p.entry - 1) * 100;
      const newHigh = px > p.peak;
      if (newHigh) p.peak = px;

      if (pct <= -25) {
        closePaperPosition(p.mint, "stop_loss", q);
        continue;
      }
      if (q.liqUsd < p.liq0 * 0.7) {
        closePaperPosition(p.mint, "liquidity_drop", q);
        continue;
      }
      if (now - p.openedAt >= 30 * 60000) {
        closePaperPosition(p.mint, "max_hold", q);
        continue;
      }
      if (pct >= 50) p.trailArmed = true;
      if (p.trailArmed && px <= p.peak * 0.8) {
        closePaperPosition(p.mint, "trailing_stop", q);
        continue;
      }
      if (!p.tookHalf && pct >= 100) {
        p.tookHalf = true;
        p.halfRawPrice = q.price;
        p.realized += 0.5 * pct;
        recordEvent("paper_partial", {
          mint: p.mint,
          reason: "take_profit_half",
          pct: Number(pct.toFixed(1)),
          rawQuote: q.price,
        });
        continue;
      }
      const inBand = pct >= -10 && pct <= 15;
      if (inBand && !newHigh) {
        p.sidewaysSince = p.sidewaysSince || now;
        if (now - p.sidewaysSince >= 180 * 1000) {
          closePaperPosition(p.mint, "time_stop", q);
          continue;
        }
      } else {
        p.sidewaysSince = null;
      }
    }
    savePersistedState();
    renderAll();
  }

  // Poll Worker /signals?since=cursor
  async function pollOnceNow() {
    try {
      const workerBase = (state.cfg.workerUrl || DEFAULT_WORKER_URL).replace(/\/$/, "");
      const headers = { "content-type": "application/json" };
      if (state.cfg.appKey) headers["x-key"] = state.cfg.appKey;

      const res = await httpJson(`${workerBase}/signals?since=${state.since}`, { headers });
      state.workerLatencyMs = res.latencyMs;
      if (!res.ok || !res.data) {
        state.workerOnline = false;
        renderAll();
        showToast(`Worker /signals returned HTTP ${res.status}`);
        return;
      }
      state.workerOnline = true;
      const { signals = [], seq = state.since, oldestId = null, halt = false } = res.data;
      state.seq = seq;
      state.oldestId = oldestId;
      state.remoteHalt = Boolean(halt);

      if (oldestId !== null && state.since > 0 && oldestId > state.since + 1) {
        recordEvent("signal_gap", {
          since: state.since,
          oldestId,
          missingSequenceCount: oldestId - state.since - 1,
        });
      }

      const ordered = [...signals].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
      for (const s of ordered) {
        const key = s.sig ? `${s.sig}:${s.mint}` : `queue:${s.id}:${s.mint}`;
        const ageMs = Number.isFinite(Number(s.ts)) ? Math.max(0, Date.now() - Number(s.ts)) : null;

        if (state.seenKeys.includes(key)) continue;
        state.seenKeys.push(key);
        if (state.seenKeys.length > 500) state.seenKeys.shift();

        const feedItem = {
          id: s.id,
          mint: s.mint,
          sig: s.sig || null,
          ageMs,
          verdict: "PENDING",
          reasons: [],
          top10Pct: null,
          ts: Date.now(),
        };
        state.signalsFeed.unshift(feedItem);
        if (state.signalsFeed.length > 50) state.signalsFeed.pop();

        if (ageMs === null || ageMs > state.cfg.maxSignalAgeMs) {
          feedItem.verdict = "SKIPPED (STALE)";
          recordEvent("signal_skip", { signalId: s.id, mint: s.mint, reason: "stale_signal", receivedAgeMs: ageMs });
          continue;
        }
        if (state.localHalt || state.remoteHalt) {
          feedItem.verdict = "HALTED";
          recordEvent("halted_skip", { signalId: s.id, mint: s.mint, reason: "halt_active" });
          continue;
        }

        try {
          const g = await runOnChainGate(s.mint);
          feedItem.verdict = g.pass ? "PASS" : "REJECTED";
          feedItem.reasons = g.reasons;
          feedItem.top10Pct = g.top10Pct;
          recordEvent("gate", {
            signalId: s.id,
            mint: s.mint,
            pass: g.pass,
            reasons: g.reasons,
            top10Pct: g.top10Pct,
            lagMs: ageMs,
          });
          if (g.pass) {
            await openPaperPosition(s.mint, s.sig, { signalId: s.id, signalKey: key });
          }
        } catch (err) {
          feedItem.verdict = "GATE_ERROR";
          feedItem.reasons = [redactText(err.message)];
          recordEvent("gate_error", { signalId: s.id, mint: s.mint, msg: redactText(err.message) });
        }
      }

      if (Number.isFinite(Number(seq)) && Number(seq) > state.since) {
        state.since = Number(seq);
      }
      savePersistedState();
      renderAll();
      showToast(`Polled Worker (seq=${state.seq}, new=${ordered.length}, ${res.latencyMs}ms)`);
    } catch (e) {
      state.workerOnline = false;
      renderAll();
      showToast(`Poll error: ${redactText(e.message)}`);
    }
  }

  async function toggleHalt() {
    const targetHalt = !(state.localHalt || state.remoteHalt);
    state.localHalt = targetHalt;
    try {
      const workerBase = (state.cfg.workerUrl || DEFAULT_WORKER_URL).replace(/\/$/, "");
      const headers = { "content-type": "application/json" };
      if (state.cfg.appKey) headers["x-key"] = state.cfg.appKey;
      const res = await httpJson(`${workerBase}/halt?on=${targetHalt ? "1" : "0"}`, {
        method: "POST",
        headers,
      });
      if (res.ok && res.data) {
        state.remoteHalt = Boolean(res.data.halt);
      }
    } catch {
      /* local halt still enforced */
    }
    savePersistedState();
    renderAll();
    showToast(targetHalt ? "HALT ACTIVATED — New paper entries blocked" : "HALT CLEARED — Scanner ready");
  }

  async function sendHeartbeatNow() {
    try {
      const workerBase = (state.cfg.workerUrl || DEFAULT_WORKER_URL).replace(/\/$/, "");
      const headers = { "content-type": "application/json" };
      if (state.cfg.appKey) headers["x-key"] = state.cfg.appKey;
      const res = await httpJson(`${workerBase}/heartbeat`, {
        method: "POST",
        headers,
        body: { open: state.openPositions.length },
      });
      if (res.ok) {
        state.hb = { ts: Date.now(), open: state.openPositions.length };
        state.workerOnline = true;
        renderAll();
        showToast(`Heartbeat sent (open=${state.openPositions.length})`);
      } else {
        showToast(`Heartbeat HTTP ${res.status}`);
      }
    } catch (e) {
      showToast(`Heartbeat failed: ${redactText(e.message)}`);
    }
  }

  function toggleLoop() {
    loopRunning = !loopRunning;
    clearInterval(pollTimer);
    clearInterval(tickTimer);
    if (loopRunning) {
      pollOnceNow();
      pollTimer = setInterval(pollOnceNow, Math.max(1000, Number(state.cfg.pollMs) || 3000));
      tickTimer = setInterval(tickPricesNow, Math.max(1500, Number(state.cfg.priceMs) || 5000));
      showToast("Auto-loop started");
    } else {
      showToast("Auto-loop paused");
    }
    renderAll();
  }

  async function inspectMintNow() {
    const input = document.getElementById("inspectMintInput");
    const out = document.getElementById("gateInspectorResult");
    const mint = (input?.value || "").trim();
    if (!mint) {
      showToast("Paste a Solana mint address first");
      return;
    }
    out.innerHTML = `<div class="pos-card mono">Inspecting on-chain mint &amp; DexScreener pools for ${mint}...</div>`;
    try {
      const [gateRes, quoteRes] = await Promise.all([
        runOnChainGate(mint).catch((e) => ({ pass: false, reasons: [`RPC Error: ${redactText(e.message)}`], top10Pct: null })),
        fetchDexQuote(mint).catch(() => null),
      ]);

      const badgeCls = gateRes.pass ? "pill-ok" : "pill-err";
      const liqOk = quoteRes && quoteRes.liqUsd >= state.cfg.minLiqUsd;
      out.innerHTML = `
        <div class="pos-card">
          <div class="pos-top">
            <span class="mint-tag">${quoteRes?.symbol ? `${quoteRes.symbol} (${mint})` : mint}</span>
            <span class="pill ${badgeCls}">${gateRes.pass ? "GATE PASS" : "GATE REJECT"}</span>
          </div>
          <div class="pos-metrics" style="margin-bottom:10px;">
            <div><span class="metric-lbl">Top-10 Wallets</span>${gateRes.top10Pct !== null ? `${gateRes.top10Pct}%` : "N/A"} (Max ${state.cfg.maxTop10Pct}%)</div>
            <div><span class="metric-lbl">Quote Price</span>${quoteRes ? `$${quoteRes.price.toExponential(4)}` : "No Pair"}</div>
            <div><span class="metric-lbl">Pool Liquidity</span><span class="${liqOk ? "text-pos" : "text-neg"}">${quoteRes ? `$${Math.round(quoteRes.liqUsd).toLocaleString()}` : "$0"}</span></div>
            <div><span class="metric-lbl">Reasons</span>${gateRes.reasons.length ? gateRes.reasons.join(", ") : "All authorities revoked &amp; extensions clean"}</div>
          </div>
          <div class="btn-row">
            <button class="btn-primary btn-sm" onclick="window.SniperApp.openInspectedMint('${mint}')">Simulate Paper Entry (+5% Slip)</button>
            <a class="btn btn-sm" href="https://dexscreener.com/solana/${mint}" target="_blank" rel="noopener">DexScreener ↗</a>
          </div>
        </div>
      `;
    } catch (e) {
      out.innerHTML = `<div class="pos-card text-neg mono">Error: ${redactText(e.message)}</div>`;
    }
  }

  async function openInspectedMint(mint) {
    await openPaperPosition(mint, null, { source: "manual_inspector" });
  }

  function fillSampleMint(mint) {
    const input = document.getElementById("inspectMintInput");
    if (input) input.value = mint;
    inspectMintNow();
  }

  async function verifyEndToEnd() {
    const out = document.getElementById("e2eDiagOutput");
    out.innerHTML = `<div class="pos-card mono">Running 3-point End-to-End Diagnostic (Worker DO, Solana RPC, DexScreener)...</div>`;

    const workerBase = (state.cfg.workerUrl || DEFAULT_WORKER_URL).replace(/\/$/, "");
    const headers = { "content-type": "application/json" };
    if (state.cfg.appKey) headers["x-key"] = state.cfg.appKey;

    const results = [];

    // 1) Cloudflare Worker /export-kv
    try {
      const wRes = await httpJson(`${workerBase}/export-kv`, { headers });
      if (wRes.ok && wRes.data?.queue) {
        state.workerOnline = true;
        state.workerLatencyMs = wRes.latencyMs;
        state.seq = wRes.data.queue.seq ?? 0;
        state.remoteHalt = Boolean(wRes.data.queue.halt);
        state.hb = wRes.data.hb ?? null;
        results.push({
          name: "1. Cloudflare Worker (SignalQueueDO /export-kv)",
          ok: true,
          detail: `HTTP 200 (${wRes.latencyMs}ms) | seq=${state.seq}, halt=${state.remoteHalt}, items=${wRes.data.queue.items?.length ?? 0}`,
        });
      } else {
        results.push({
          name: "1. Cloudflare Worker (SignalQueueDO /export-kv)",
          ok: false,
          detail: `HTTP ${wRes.status} (${wRes.latencyMs}ms) — check APP_KEY or WORKER_URL`,
        });
      }
    } catch (e) {
      results.push({
        name: "1. Cloudflare Worker (SignalQueueDO /export-kv)",
        ok: false,
        detail: redactText(e.message),
      });
    }

    // 2) Solana JSON-RPC (getSlot)
    try {
      const started = Date.now();
      const slot = await solanaRpc("getSlot", []);
      results.push({
        name: "2. Solana Helius JSON-RPC (getSlot)",
        ok: true,
        detail: `HTTP 200 (${Date.now() - started}ms) | Current Mainnet Slot: ${slot}`,
      });
    } catch (e) {
      results.push({
        name: "2. Solana Helius JSON-RPC (getSlot)",
        ok: false,
        detail: redactText(e.message),
      });
    }

    // 3) DexScreener Quote Feed
    try {
      const started = Date.now();
      const q = await fetchDexQuote("So11111111111111111111111111111111111111112");
      results.push({
        name: "3. DexScreener Solana Quote Feed (WSOL)",
        ok: Boolean(q && q.price > 0),
        detail: q
          ? `HTTP 200 (${Date.now() - started}ms) | WSOL=$${q.price.toFixed(2)}, Top Pool Liq=$${Math.round(q.liqUsd).toLocaleString()}`
          : "No quote returned",
      });
    } catch (e) {
      results.push({
        name: "3. DexScreener Solana Quote Feed (WSOL)",
        ok: false,
        detail: redactText(e.message),
      });
    }

    out.innerHTML = results
      .map(
        (r) => `
      <div class="pos-card">
        <div class="pos-top">
          <span class="mono" style="font-weight:700;">${r.name}</span>
          <span class="pill ${r.ok ? "pill-ok" : "pill-err"}">${r.ok ? "CONNECTED" : "ERROR"}</span>
        </div>
        <div class="kpi-sub">${r.detail}</div>
      </div>`
      )
      .join("");
    renderAll();
  }

  function saveSettings() {
    state.cfg.workerUrl = (document.getElementById("cfgWorkerUrl")?.value || DEFAULT_WORKER_URL).trim();
    const appKeyVal = (document.getElementById("cfgAppKey")?.value || "").trim();
    const rpcUrlVal = (document.getElementById("cfgRpcUrl")?.value || "").trim();
    if (appKeyVal) state.cfg.appKey = appKeyVal;
    if (rpcUrlVal) state.cfg.rpcUrl = rpcUrlVal;
    state.cfg.pollMs = Math.max(500, Number(document.getElementById("cfgPollMs")?.value) || 3000);
    state.cfg.priceMs = Math.max(1000, Number(document.getElementById("cfgPriceMs")?.value) || 5000);
    state.cfg.maxOpen = Math.max(1, Math.min(25, Math.floor(Number(document.getElementById("cfgMaxOpen")?.value) || 5)));
    state.cfg.minLiqUsd = Math.max(0, Number(document.getElementById("cfgMinLiqUsd")?.value) || 15000);
    state.cfg.maxTop10Pct = Math.max(1, Math.min(100, Number(document.getElementById("cfgMaxTop10Pct")?.value) || 35));

    savePersistedConfig();
    renderAll();
    showToast("Saved connection & risk settings");
  }

  // Exact report computation matching src/report.js
  function computeSummary() {
    const rows = state.events;
    const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    const median = (a) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    const gates = rows.filter((r) => r.ev === "gate");
    const gateErrors = rows.filter((r) => r.ev === "gate_error");
    const skips = rows.filter((r) => r.ev === "signal_skip" || r.ev === "halted_skip" || String(r.ev).startsWith("skip_"));
    const opened = rows.filter((r) => r.ev === "paper_open");
    const closed = rows.filter((r) => r.ev === "paper_close" && Number.isFinite(Number(r.pnl)));
    const chronPnls = closed.map((r) => Number(r.pnl));
    const sortedPnls = [...chronPnls].sort((a, b) => a - b);
    const pnls2x = closed
      .map((r) => (Number.isFinite(Number(r.pnl2xSlip)) ? Number(r.pnl2xSlip) : Number(r.pnl) - 18))
      .filter(Number.isFinite);

    let cumPct = 0, peakCum = 0, maxDdPts = 0;
    let eq = 100, peakEq = 100, maxDdEq = 0;
    const eqSeries = [100];
    for (const pnl of chronPnls) {
      cumPct += pnl;
      if (cumPct > peakCum) peakCum = cumPct;
      if (peakCum - cumPct > maxDdPts) maxDdPts = peakCum - cumPct;
      eq = Math.max(0, eq * (1 + (pnl / 100) * 0.1));
      if (eq > peakEq) peakEq = eq;
      const dd = peakEq > 0 ? ((peakEq - eq) / peakEq) * 100 : 0;
      if (dd > maxDdEq) maxDdEq = dd;
      eqSeries.push(Number(eq.toFixed(2)));
    }

    const byReason = {};
    for (const r of closed) {
      const k = r.reason || "unknown";
      (byReason[k] ??= []).push(Number(r.pnl));
    }
    const bySkipReason = {};
    for (const r of skips) {
      const k = r.reason || r.ev;
      bySkipReason[k] = (bySkipReason[k] || 0) + 1;
    }

    const meanPnl = Number(mean(sortedPnls).toFixed(2));
    const medianPnl = Number(median(sortedPnls).toFixed(2));
    const meanPnl2x = Number(mean(pnls2x).toFixed(2));
    const medianPnl2x = Number(median(pnls2x).toFixed(2));
    const winRatePct = sortedPnls.length
      ? Number(((sortedPnls.filter((x) => x > 0).length / sortedPnls.length) * 100).toFixed(1))
      : 0;
    const passesEvalGate =
      closed.length >= 200 && meanPnl > 0 && medianPnl > 0 && meanPnl2x > 0 && medianPnl2x > 0;

    return {
      signalsGated: gates.length,
      signalsPassed: gates.filter((g) => g.pass).length,
      gateErrors: gateErrors.length,
      openedCount: opened.length,
      closedCount: closed.length,
      closedRows: closed,
      winRatePct,
      meanPnl,
      medianPnl,
      meanPnl2x,
      medianPnl2x,
      maxDdPts: Number(maxDdPts.toFixed(2)),
      maxDdEq: Number(maxDdEq.toFixed(2)),
      endingEquity: Number(eq.toFixed(2)),
      eqSeries,
      byReason,
      bySkipReason,
      passesEvalGate,
      meanFn: mean,
      medianFn: median,
    };
  }

  function renderAll() {
    const sum = computeSummary();
    const isHalted = state.localHalt || state.remoteHalt;

    // Header pills
    const wPill = document.getElementById("workerStatusPill");
    const wTxt = document.getElementById("workerStatusText");
    if (wPill && wTxt) {
      wPill.className = `pill ${state.workerOnline ? "pill-ok" : "pill-warn"}`;
      wTxt.textContent = state.workerOnline
        ? `WORKER: ONLINE (${state.workerLatencyMs ?? "--"}ms)`
        : "WORKER: STANDBY";
    }

    const hPill = document.getElementById("haltStatusPill");
    const hTxt = document.getElementById("haltStatusText");
    const btnHalt = document.getElementById("btnHaltToggle");
    if (hPill && hTxt) {
      hPill.className = `pill ${isHalted ? "pill-err" : "pill-ok"}`;
      hTxt.textContent = isHalted ? "HALT: ACTIVE" : "HALT: OFF";
    }
    if (btnHalt) {
      btnHalt.textContent = isHalted ? "▶ RESUME ENTRIES" : "■ HALT ENTRIES";
      btnHalt.classList.toggle("active-halt", isHalted);
    }

    const btnLoop = document.getElementById("btnToggleLoop");
    const loopSub = document.getElementById("scannerLoopStatus");
    if (btnLoop) btnLoop.textContent = loopRunning ? "⏸ Pause Auto-Loop" : "▶ Start Auto-Loop";
    if (loopSub) {
      loopSub.textContent = loopRunning
        ? `Auto-loop ACTIVE: polling every ${state.cfg.pollMs}ms, ticking quotes every ${state.cfg.priceMs}ms`
        : "Auto-loop paused (Tap Start Auto-Loop or Poll Signals Now)";
    }

    // KPIs
    const setTxt = (id, t) => {
      const e = document.getElementById(id);
      if (e) e.textContent = t;
    };
    const unresolvedCnt = state.openPositions.filter((p) => p.unresolvedMissingQuote).length;
    setTxt("kpiOpenSlots", `${state.openPositions.length} / ${state.cfg.maxOpen}`);
    setTxt("kpiUnresolvedSub", `Unresolved: ${unresolvedCnt} | Archived: ${state.archivedPositions.length}`);
    setTxt("kpiClosedCount", `${sum.closedCount} / 200`);
    const fill = document.getElementById("evalProgressFill");
    if (fill) fill.style.width = `${Math.min(100, (sum.closedCount / 200) * 100)}%`;
    setTxt(
      "kpiEvalVerdict",
      sum.passesEvalGate
        ? "PASS (Eligible for review; paper-only enforced)"
        : `INCOMPLETE (${sum.closedCount}/200 closed trades)`
    );
    setTxt("kpiWinRate", `${sum.winRatePct.toFixed(1)}%`);
    setTxt("kpiPnl1x", `Mean: ${sum.meanPnl.toFixed(2)}% | Med: ${sum.medianPnl.toFixed(2)}%`);
    setTxt("kpiMean2x", `${sum.meanPnl2x.toFixed(2)}%`);
    setTxt("kpiMed2x", `Med 2x: ${sum.medianPnl2x.toFixed(2)}% (10% in / 16% out)`);
    setTxt("kpiEquityIdx", sum.endingEquity.toFixed(2));
    setTxt("kpiDrawdown", `Max DD: ${sum.maxDdEq.toFixed(2)}% (${sum.maxDdPts.toFixed(2)} pts)`);
    setTxt("kpiSeqCursor", `seq: ${state.seq}`);
    const hbStr = state.hb?.ts ? `${Math.max(0, Math.round((Date.now() - state.hb.ts) / 1000))}s ago` : "--";
    setTxt("kpiHeartbeatSub", `Cursor: ${state.since} | HB: ${hbStr}`);

    setTxt("cntOpen", state.openPositions.length);
    setTxt("cntClosed", sum.closedCount);
    setTxt("cntArchived", state.archivedPositions.length);

    // Render Open Positions
    const openHtml = state.openPositions.length
      ? state.openPositions
          .map((p) => {
            const unrealPct = p.entry > 0 ? (((p.lastExecPrice / p.entry) - 1) * 100) : 0;
            const heldSec = Math.max(0, Math.round((Date.now() - p.openedAt) / 1000));
            return `
          <div class="pos-card">
            <div class="pos-top">
              <span class="mint-tag">${p.symbol ? `${p.symbol} · ` : ""}${p.mint}</span>
              <span class="pill ${unrealPct >= 0 ? "pill-ok" : "pill-err"}">${unrealPct >= 0 ? "+" : ""}${unrealPct.toFixed(2)}%</span>
            </div>
            <div class="pos-metrics">
              <div><span class="metric-lbl">Entry (+5%)</span>$${Number(p.entry).toExponential(3)}</div>
              <div><span class="metric-lbl">Exec (-8%)</span>$${Number(p.lastExecPrice).toExponential(3)}</div>
              <div><span class="metric-lbl">Liquidity</span>$${Math.round(p.lastLiqUsd || p.liq0).toLocaleString()}</div>
              <div><span class="metric-lbl">Held / Flags</span>${heldSec}s ${p.tookHalf ? "· 50% TP" : ""} ${p.trailArmed ? "· TRAIL" : ""} ${p.unresolvedMissingQuote ? "· UNRESOLVED" : ""}</div>
            </div>
            <div class="btn-row" style="margin-top:8px;">
              <button class="btn-sm btn-danger" onclick="window.SniperApp.manualClose('${p.mint}')">Paper Exit Now</button>
              <a class="btn btn-sm" href="https://dexscreener.com/solana/${p.mint}" target="_blank" rel="noopener">DexScreener ↗</a>
            </div>
          </div>`;
          })
          .join("")
      : `<div class="empty-state">No active paper positions.</div>`;

    const dashOpen = document.getElementById("dashOpenPositions");
    const listOpen = document.getElementById("listOpenPositions");
    if (dashOpen) dashOpen.innerHTML = openHtml;
    if (listOpen) listOpen.innerHTML = openHtml;

    // Render Closed Positions
    const listClosed = document.getElementById("listClosedPositions");
    if (listClosed) {
      listClosed.innerHTML = sum.closedRows.length
        ? [...sum.closedRows]
            .reverse()
            .map(
              (c) => `
          <div class="pos-card">
            <div class="pos-top">
              <span class="mint-tag">${c.mint}</span>
              <span class="pill ${c.pnl >= 0 ? "pill-ok" : "pill-err"}">${c.reason} · ${c.pnl >= 0 ? "+" : ""}${Number(c.pnl).toFixed(2)}%</span>
            </div>
            <div class="pos-metrics">
              <div><span class="metric-lbl">1x Slip PnL</span>${Number(c.pnl).toFixed(2)}%</div>
              <div><span class="metric-lbl">2x Slip PnL</span>${c.pnl2xSlip !== undefined ? `${Number(c.pnl2xSlip).toFixed(2)}%` : "N/A"}</div>
              <div><span class="metric-lbl">Held Duration</span>${c.heldSec ?? 0}s</div>
              <div><span class="metric-lbl">Timestamp</span>${(c.ts || "").slice(11, 19)}</div>
            </div>
          </div>`
            )
            .join("")
        : `<div class="empty-state">No closed paper trades yet.</div>`;
    }

    // Render Archived Unresolved
    const listArch = document.getElementById("listArchivedPositions");
    if (listArch) {
      listArch.innerHTML = state.archivedPositions.length
        ? state.archivedPositions
            .map(
              (a) => `
          <div class="pos-card">
            <div class="pos-top">
              <span class="mint-tag">${a.mint}</span>
              <span class="pill pill-warn">ARCHIVED UNRESOLVED (${a.missingDurationSec ?? "?"}s)</span>
            </div>
          </div>`
            )
            .join("")
        : `<div class="empty-state">No archived unresolved positions.</div>`;
    }

    // Render Recent Events on Dashboard
    const dashEvents = document.getElementById("dashRecentEvents");
    if (dashEvents) {
      const recent = [...state.events].slice(-8).reverse();
      dashEvents.innerHTML = recent.length
        ? recent
            .map(
              (e) => `
          <div class="pos-card" style="padding:8px 10px;">
            <span class="pill pill-paper">${e.ev}</span>
            <span class="mono" style="font-size:11px; margin-left:6px; color:var(--text-muted);">${(e.ts || "").slice(11, 19)}</span>
            <div class="mono" style="font-size:11px; margin-top:4px; word-break:break-all;">${e.mint ? `mint=${e.mint} ` : ""}${e.reason ? `reason=${e.reason} ` : ""}${e.pnl !== undefined ? `pnl=${e.pnl}% ` : ""}${e.reasons?.length ? `reasons=[${e.reasons.join(", ")}]` : ""}</div>
          </div>`
            )
            .join("")
        : `<div class="empty-state">No events recorded yet.</div>`;
    }

    // Render Signals Feed
    const sigFeed = document.getElementById("listSignalsFeed");
    if (sigFeed && state.signalsFeed.length) {
      sigFeed.innerHTML = state.signalsFeed
        .map(
          (s) => `
        <div class="pos-card">
          <div class="pos-top">
            <span class="mint-tag">#${s.id} · ${s.mint}</span>
            <span class="pill ${s.verdict === "PASS" ? "pill-ok" : s.verdict.startsWith("SKIP") ? "pill-warn" : "pill-err"}">${s.verdict}</span>
          </div>
          <div class="kpi-sub">Lag: ${s.ageMs !== null ? `${s.ageMs}ms` : "N/A"} | Top10: ${s.top10Pct !== null ? `${s.top10Pct}%` : "--"} | ${s.reasons.length ? s.reasons.join(", ") : "Clean"}</div>
        </div>`
        )
        .join("");
    }

    // Render Analytics Tables & SVG Chart
    const tblReason = document.getElementById("tableByReason");
    if (tblReason) {
      const entries = Object.entries(sum.byReason);
      tblReason.innerHTML = entries.length
        ? entries
            .map(
              ([k, arr]) =>
                `<tr><td>${k}</td><td>${arr.length}</td><td>${sum.meanFn(arr).toFixed(1)}%</td><td>${sum.medianFn(arr).toFixed(1)}%</td></tr>`
            )
            .join("")
        : `<tr><td colspan="4" class="empty-state">No closed trades yet</td></tr>`;
    }

    const tblSkip = document.getElementById("tableBySkip");
    if (tblSkip) {
      const entries = Object.entries(sum.bySkipReason);
      tblSkip.innerHTML = entries.length
        ? entries.map(([k, cnt]) => `<tr><td>${k}</td><td>${cnt}</td></tr>`).join("")
        : `<tr><td colspan="2" class="empty-state">No skips recorded</td></tr>`;
    }

    const chartBox = document.getElementById("equityChartContainer");
    if (chartBox) {
      const pts = sum.eqSeries;
      if (pts.length < 2) {
        chartBox.innerHTML = `<span class="empty-state">Close at least 1 paper trade to plot equity curve (Start = 100.00)</span>`;
      } else {
        const minV = Math.min(...pts, 95);
        const maxV = Math.max(...pts, 105);
        const span = Math.max(1, maxV - minV);
        const coords = pts
          .map((v, i) => {
            const x = 20 + (i / (pts.length - 1)) * 560;
            const y = 150 - ((v - minV) / span) * 120;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
        chartBox.innerHTML = `
          <svg viewBox="0 0 600 170" width="100%" height="170">
            <line x1="20" y1="90" x2="580" y2="90" stroke="#1f2d47" stroke-dasharray="4 4" />
            <polyline fill="none" stroke="#10b981" stroke-width="3" points="${coords}" />
          </svg>`;
      }
    }

    const repPre = document.getElementById("formattedReportText");
    if (repPre) {
      repPre.textContent = [
        `Signals gated: ${sum.signalsGated}  passed: ${sum.signalsPassed}  gate_errors: ${sum.gateErrors}`,
        `Positions opened: ${sum.openedCount}  Closed trades: ${sum.closedCount}  Unresolved/open: ${state.openPositions.length}  Archived unresolved: ${state.archivedPositions.length}`,
        `Win rate: ${sum.winRatePct.toFixed(1)}%`,
        `Mean pnl (1x slip): ${sum.meanPnl.toFixed(2)}%  Median: ${sum.medianPnl.toFixed(2)}%`,
        `2x Slippage sensitivity -> Mean pnl: ${sum.meanPnl2x.toFixed(2)}%  Median: ${sum.medianPnl2x.toFixed(2)}%`,
        `Max drawdown: ${sum.maxDdPts.toFixed(2)} pct-pts (10%-stake equity DD: ${sum.maxDdEq.toFixed(2)}%, ending index: ${sum.endingEquity.toFixed(2)})`,
        `Evaluation gate (>=200 trades & positive 1x/2x mean+median): ${
          sum.passesEvalGate
            ? "PASS (eligible for next-stage discussion; paper-only remains enforced)"
            : `INCOMPLETE/FAIL (closed=${sum.closedCount}/200, mean2x=${sum.meanPnl2x.toFixed(2)}%, median2x=${sum.medianPnl2x.toFixed(2)}%)`
        }`,
      ].join("\n");
    }
  }

  function switchTab(tabId) {
    for (const id of ["dashboard", "positions", "signals", "analytics", "settings"]) {
      document.getElementById(`tab-${id}`)?.classList.toggle("active", id === tabId);
      document.getElementById(`nav-${id}`)?.classList.toggle("active", id === tabId);
    }
  }

  function switchPosSubTab(sub) {
    for (const k of ["open", "closed", "archived"]) {
      const panel = document.getElementById(`pos-panel-${k}`);
      const btn = document.getElementById(`subtab-btn-${k}`);
      if (panel) panel.style.display = k === sub ? "block" : "none";
      if (btn) btn.classList.toggle("active", k === sub);
    }
  }

  function exportJsonl() {
    const content = state.events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const blob = new Blob([content], { type: "application/jsonl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "paper.jsonl";
    a.click();
    showToast(`Exported ${state.events.length} JSONL events`);
  }

  function resetDemoData() {
    state.events = [];
    state.signalsFeed = [];
    savePersistedState();
    renderAll();
    showToast("Cleared local session event logs");
  }

  async function init() {
    loadPersistedConfig();
    loadPersistedState();

    // Detect if local Node server (/api/status) is serving this UI
    if (!hasAndroidBridge() && location.protocol.startsWith("http")) {
      try {
        const r = await fetch("/api/status");
        if (r.ok) {
          const j = await r.json();
          hasLocalNodeApi = true;
          if (j.workerUrl && (!state.cfg.workerUrl || state.cfg.workerUrl === DEFAULT_WORKER_URL)) {
            state.cfg.workerUrl = j.workerUrl;
          }
          if (Array.isArray(j.openPositions) && j.openPositions.length && !state.openPositions.length) {
            state.openPositions = j.openPositions;
          }
          if (Array.isArray(j.events) && j.events.length && !state.events.length) {
            state.events = j.events;
          }
        }
      } catch {
        hasLocalNodeApi = false;
      }
    }

    const badge = document.getElementById("runtimeEnvBadge");
    if (badge) {
      badge.textContent = hasAndroidBridge()
        ? "Runtime: Native Android APK Bridge"
        : hasLocalNodeApi
        ? "Runtime: Node E2E Proxy (.env Active)"
        : "Runtime: Browser Direct";
    }

    const setInput = (id, v) => {
      const e = document.getElementById(id);
      if (e && v !== undefined && v !== null) e.value = v;
    };
    setInput("cfgWorkerUrl", state.cfg.workerUrl);
    setInput("cfgAppKey", state.cfg.appKey);
    setInput("cfgRpcUrl", state.cfg.rpcUrl);
    setInput("cfgPollMs", state.cfg.pollMs);
    setInput("cfgPriceMs", state.cfg.priceMs);
    setInput("cfgMaxOpen", state.cfg.maxOpen);
    setInput("cfgMinLiqUsd", state.cfg.minLiqUsd);
    setInput("cfgMaxTop10Pct", state.cfg.maxTop10Pct);

    renderAll();
  }

  window.SniperApp = {
    switchTab,
    switchPosSubTab,
    toggleLoop,
    pollOnceNow,
    tickPricesNow,
    toggleHalt,
    sendHeartbeatNow,
    inspectMintNow,
    openInspectedMint,
    fillSampleMint,
    verifyEndToEnd,
    saveSettings,
    manualClose: (mint) => closePaperPosition(mint, "manual_paper_close"),
    exportJsonl,
    resetDemoData,
  };

  window.addEventListener("DOMContentLoaded", init);
})();
