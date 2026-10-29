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

// Returns { pass, reasons[], top10Pct }. Any failed check rejects the token.
export async function runGate(mint, gateCfg, rpcFn = rpc) {
  const reasons = [];

  // 1) Authorities must be revoked.
  const acc = await rpcFn("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = acc?.value?.data?.parsed?.info;
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
