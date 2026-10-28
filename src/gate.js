import { rpc } from "./rpc.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function hasNonEmptyAuthority(val) {
  return typeof val === "string" && val.trim().length > 0;
}

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

    if (name === "permanentDelegate" && hasNonEmptyAuthority(state.delegate)) {
      reasons.push("permanent delegate active");
    } else if (
      name === "transferHook" &&
      (hasNonEmptyAuthority(state.programId) || hasNonEmptyAuthority(state.authority))
    ) {
      reasons.push("transfer hook active");
    } else if (name === "transferFeeConfig") {
      const olderBps = Number(state?.olderTransferFee?.transferFeeBasisPoints ?? 0);
      const newerBps = Number(state?.newerTransferFee?.transferFeeBasisPoints ?? 0);
      if (
        (Number.isFinite(olderBps) && olderBps > 0) ||
        (Number.isFinite(newerBps) && newerBps > 0) ||
        hasNonEmptyAuthority(state.transferFeeConfigAuthority) ||
        hasNonEmptyAuthority(state.withdrawWithheldAuthority)
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
    } else if (
      (name === "mintCloseAuthority" || name === "closeAuthority") &&
      hasNonEmptyAuthority(state.closeAuthority)
    ) {
      reasons.push("mint close authority active");
    } else if (
      (name === "pausable" || name === "pausableConfig") &&
      (Boolean(state.paused) || hasNonEmptyAuthority(state.authority))
    ) {
      reasons.push("pausable mint active");
    }
  }

  return [...new Set(reasons)];
}

// Returns { pass, reasons[], top10Pct }. Any failed check rejects the token.
// Note: This gate inspects on-chain mint/freeze authority, Token-2022 dangerous extensions,
// and top-20 token account concentration. It CANNOT detect un-burned LP tokens, off-chain
// wallet bundling/sybils, or post-entry liquidity withdrawals.
export async function runGate(mint, gateCfg, deps = {}) {
  const rpcFn = deps.rpc ?? rpc;
  const reasons = [];

  if (!mint || typeof mint !== "string") {
    return { pass: false, reasons: ["invalid mint address"], top10Pct: null };
  }

  // 1) Authorities must be revoked and dangerous Token-2022 extensions must be absent.
  const acc = await rpcFn("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = acc?.value?.data?.parsed?.info;
  if (!info || !Number.isFinite(Number(info.decimals))) {
    return { pass: false, reasons: ["not a parsed SPL mint"], top10Pct: null };
  }
  if (info.mintAuthority) reasons.push("mint authority not revoked");
  if (info.freezeAuthority) reasons.push("freeze authority not revoked");
  for (const extReason of inspectMintExtensions(info)) {
    reasons.push(extReason);
  }

  // 2) Holder concentration, counting wallet-owned accounts and aggregating by owner wallet.
  //    Pool vaults / bonding curves are owned by programs (PDAs), so they are excluded.
  //    Unfunded system accounts (ownerInfo === null) still represent wallet addresses.
  const supply = Number((await rpcFn("getTokenSupply", [mint]))?.value?.uiAmount ?? 0);
  if (!Number.isFinite(supply) || supply <= 0) {
    reasons.push("invalid or zero token supply");
    return { pass: false, reasons, top10Pct: 100 };
  }

  const largest = ((await rpcFn("getTokenLargestAccounts", [mint]))?.value ?? []).slice(0, 20);
  const jp = { encoding: "jsonParsed" };
  const tokenAccs = largest.length
    ? (await rpcFn("getMultipleAccounts", [largest.map((a) => a.address), jp]))?.value ?? []
    : [];
  const owners = tokenAccs.map((a) => a?.data?.parsed?.info?.owner ?? null);
  const ownerKeys = [...new Set(owners.filter(Boolean))];
  const noData = { encoding: "base64", dataSlice: { offset: 0, length: 0 } };
  const ownerInfo = ownerKeys.length
    ? (await rpcFn("getMultipleAccounts", [ownerKeys, noData]))?.value ?? []
    : [];
  const isWallet = new Map(
    ownerKeys.map((k, i) => {
      const acct = ownerInfo[i];
      // A null account info means 0-lamport unfunded system address (still a wallet, not a deployed program PDA).
      return [k, acct === null || acct === undefined || acct?.owner === SYSTEM_PROGRAM];
    }),
  );

  // Aggregate balances by owner wallet so splitting across multiple token accounts cannot bypass top-10 concentration.
  const byOwner = new Map();
  for (let i = 0; i < largest.length; i++) {
    const owner = owners[i];
    if (!owner || isWallet.get(owner) !== true) continue;
    const amt = Number(largest[i]?.uiAmount ?? 0);
    if (Number.isFinite(amt) && amt > 0) {
      byOwner.set(owner, (byOwner.get(owner) ?? 0) + amt);
    }
  }

  const top10WalletAmounts = [...byOwner.values()]
    .sort((a, b) => b - a)
    .slice(0, 10);

  const top10Pct = (top10WalletAmounts.reduce((s, amt) => s + amt, 0) / supply) * 100;
  if (top10Pct > gateCfg.maxTop10Pct) {
    reasons.push(`top10 wallets hold ${top10Pct.toFixed(1)}% (> ${gateCfg.maxTop10Pct}%)`);
  }

  return { pass: reasons.length === 0, reasons, top10Pct: Number(top10Pct.toFixed(1)) };
}
