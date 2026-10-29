import { rpc } from "./rpc.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Inspect parsed SPL / Token-2022 mint info for dangerous extensions that can freeze,
// tax, seize, or block transfers even when mintAuthority and freezeAuthority are null.
export function inspectMintExtensions(info) {
  const reasons = [];
  if (!info || typeof info !== "object") return reasons;

  if (info.isInitialized === false) {
    reasons.push("mint not initialized");
  }

  const extensions = Array.isArray(info.extensions) ? info.extensions : [];
  for (const ext of extensions) {
    const name = typeof ext?.extension === "string" ? ext.extension.trim() : "";
    const state = ext?.state && typeof ext.state === "object" ? ext.state : {};

    if (name === "permanentDelegate" && state.delegate) {
      reasons.push("permanent delegate active");
    } else if (name === "transferHook" && (state.programId || state.authority)) {
      reasons.push("transfer hook active");
    } else if (name === "transferFeeConfig") {
      const olderBps = Number(state?.olderTransferFee?.transferFeeBasisPoints ?? 0);
      const newerBps = Number(state?.newerTransferFee?.transferFeeBasisPoints ?? 0);
      if (
        (Number.isFinite(olderBps) && olderBps > 0) ||
        (Number.isFinite(newerBps) && newerBps > 0) ||
        state.transferFeeConfigAuthority ||
        state.withdrawWithheldAuthority
      ) {
        reasons.push("transfer fee active");
      }
    } else if (name === "defaultAccountState") {
      const acctState = String(state.state ?? state.accountState ?? "").trim().toLowerCase();
      if (acctState === "frozen") {
        reasons.push("default account state frozen");
      }
    } else if (name === "nonTransferable") {
      reasons.push("non-transferable mint");
    } else if (name === "mintCloseAuthority" && state.closeAuthority) {
      reasons.push("mint close authority active");
    } else if (name === "pausable" && (state.paused || state.authority)) {
      reasons.push("pausable mint active");
    }
  }

  return [...new Set(reasons)];
}

export function extractSolanaAddress(input) {
  if (!input) return "";
  const trimmed = String(input).trim();
  const m = trimmed.match(/(?:solana\/|coin\/|token\/|address\/|^)([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (m && m[1]) return m[1];
  const clean = trimmed.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  return clean ? clean[0] : trimmed;
}

// Helper to decode raw 82-byte SPL Mint if RPC returns base64 instead of jsonParsed
function parseRawMintAccount(data) {
  if (data?.parsed && data.parsed.type === "mint") {
    return data.parsed.info;
  }
  let b64 = "";
  if (Array.isArray(data) && typeof data[0] === "string") b64 = data[0];
  else if (typeof data === "string") b64 = data;
  if (!b64) return null;

  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 82) return null;

    const mintAuthOption = buf.readUInt32LE(0);
    const mintAuthority = mintAuthOption === 0 ? null : "active";
    const rawSupply = buf.readBigUInt64LE(36);
    const decimals = buf.readUInt8(44);
    const isInitialized = buf.readUInt8(45) !== 0;
    const freezeAuthOption = buf.readUInt32LE(46);
    const freezeAuthority = freezeAuthOption === 0 ? null : "active";

    return {
      mintAuthority,
      freezeAuthority,
      isInitialized,
      supply: rawSupply.toString(),
      decimals,
    };
  } catch {
    return null;
  }
}

// Returns { pass, reasons[], top10Pct }. Any failed check rejects the token.
export async function runGate(mint, gateCfg, rpcFn = rpc) {
  const reasons = [];
  const cleanMint = extractSolanaAddress(mint);

  // 1) Authorities must be revoked.
  let acc;
  try {
    acc = await rpcFn("getAccountInfo", [cleanMint, { encoding: "jsonParsed" }]);
  } catch (err) {
    return { pass: false, reasons: [`RPC query error: ${err.message || 'unreachable'}`], top10Pct: null };
  }

  const data = acc?.value?.data;
  const info = data?.parsed?.info || parseRawMintAccount(data);
  if (!info) return { pass: false, reasons: ["not a parsed SPL mint"], top10Pct: null };
  if (info.mintAuthority) reasons.push("mint authority not revoked");
  if (info.freezeAuthority) reasons.push("freeze authority not revoked");

  // Check dangerous Token-2022 extensions
  for (const extReason of inspectMintExtensions(info)) {
    reasons.push(extReason);
  }

  // 2) Holder concentration, counting only wallet-owned accounts.
  //    Pool vaults / bonding curves are owned by programs (PDAs), so they are excluded.
  //    Unfunded system accounts (ownerInfo[i] === null) are wallets with 0 SOL.
  let supply = 0;
  if (info.supply != null) {
    const decimals = Number(info.decimals ?? 0);
    supply = Number(info.supply) / 10 ** decimals;
  }
  if (!supply) {
    try {
      supply = Number((await rpcFn("getTokenSupply", [mint]))?.value?.uiAmount ?? 0);
    } catch {
      // ignore
    }
  }

  let top10Pct = 0;
  try {
    const largestRes = await rpcFn("getTokenLargestAccounts", [mint]);
    const largest = (largestRes?.value ?? []).slice(0, 20);
    if (largest.length > 0) {
      const jp = { encoding: "jsonParsed" };
      const tokenAccs = (await rpcFn("getMultipleAccounts", [largest.map((a) => a.address), jp]))?.value ?? [];
      const owners = tokenAccs.map((a) => a?.data?.parsed?.info?.owner ?? null);
      const ownerKeys = [...new Set(owners.filter(Boolean))];
      const noData = { encoding: "base64", dataSlice: { offset: 0, length: 0 } };
      const ownerInfo = ownerKeys.length
        ? (await rpcFn("getMultipleAccounts", [ownerKeys, noData]))?.value ?? []
        : [];
      const isWallet = new Map(ownerKeys.map((k, i) => [k, ownerInfo[i] === null || ownerInfo[i]?.owner === SYSTEM_PROGRAM]));

      // Aggregate holdings by owner wallet
      const byOwner = new Map();
      for (let i = 0; i < largest.length; i++) {
        const owner = owners[i];
        if (owner && isWallet.get(owner) === true) {
          const amt = Number(largest[i]?.uiAmount ?? 0);
          byOwner.set(owner, (byOwner.get(owner) ?? 0) + amt);
        }
      }

      const topWallets = [...byOwner.values()].sort((a, b) => b - a).slice(0, 10);
      top10Pct = supply > 0 ? (topWallets.reduce((s, amt) => s + amt, 0) / supply) * 100 : 100;
      if (top10Pct > gateCfg.maxTop10Pct) {
        reasons.push(`top10 wallets hold ${top10Pct.toFixed(1)}% (> ${gateCfg.maxTop10Pct}%)`);
      }
    }
  } catch {
    // Free public RPC nodes (e.g. publicnode) reject unindexed requests.
    // If authorities and extensions are clean, do not fail closed on public RPC block.
  }

  return { pass: reasons.length === 0, reasons, top10Pct: Number(top10Pct.toFixed(1)) };
}
