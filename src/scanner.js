#!/usr/bin/env node
/**
 * Live Solana Scanner Daemon
 * Continuously polls DexScreener for fresh Solana token profiles and new pairs,
 * pushing live signals to Worker /hook.
 */

import { cfg } from "./config.js";
import { notify } from "./api.js";
import { log } from "./log.js";

const seen = new Set();
const POLL_INTERVAL_MS = 6000;

console.log("=================================================");
console.log("📡 Solana Sniper Bot — Live DEX Scanner Daemon");
console.log(`Worker Hook: ${cfg.workerUrl}/hook`);
console.log("=================================================\n");

async function scanDexScreener() {
  try {
    const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      log("scanner_http_error", { status: res.status });
      return;
    }

    const tokens = await res.json();
    if (!Array.isArray(tokens)) return;

    const solanaTokens = tokens.filter(
      (t) => t.chainId === "solana" && typeof t.tokenAddress === "string" && t.tokenAddress
    );

    const newMints = [];
    for (const token of solanaTokens) {
      const mint = token.tokenAddress.trim();
      if (seen.has(mint)) continue;
      seen.add(mint);
      newMints.push({
        mint,
        url: token.url,
        description: token.description || "",
      });
    }

    if (newMints.length > 0) {
      console.log(`[${new Date().toLocaleTimeString()}] Discovered ${newMints.length} fresh Solana mints:`);
      for (const item of newMints) {
        console.log(`   + ${item.mint} (${item.url || 'DexScreener'})`);
      }

      // Dispatch to Worker /hook
      const payload = newMints.map((item, idx) => ({
        signature: `dex_${Date.now()}_${idx}`,
        timestamp: Math.floor(Date.now() / 1000),
        tokenTransfers: [{ mint: item.mint }],
      }));

      const hookRes = await fetch(`${cfg.workerUrl}/hook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.appKey ? { "x-key": cfg.appKey } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });

      if (hookRes.ok) {
        for (const item of newMints) {
          notify(`📡 LIVE DISCOVERY: ${item.mint}\nURL: ${item.url || 'DexScreener'}`);
        }
      }
    }
  } catch (err) {
    log("scanner_error", { error: err.message || String(err) });
  }
}

// Keep seen set from growing unbounded (cap at 10,000)
function pruneSeen() {
  if (seen.size > 10000) {
    const arr = Array.from(seen).slice(-5000);
    seen.clear();
    for (const m of arr) seen.add(m);
  }
}

async function loop() {
  await scanDexScreener();
  pruneSeen();
  setTimeout(loop, POLL_INTERVAL_MS);
}

loop();
