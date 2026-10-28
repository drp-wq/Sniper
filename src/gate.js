import { rpc } from "./rpc.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// Returns { pass, reasons[], top10Pct }. Any failed check rejects the token.
export async function runGate(mint, gateCfg) {
  const reasons = [];

  // 1) Authorities must be revoked.
  const acc = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const info = acc?.value?.data?.parsed?.info;
  if (!info) return { pass: false, reasons: ["not a parsed SPL mint"], top10Pct: null };
  if (info.mintAuthority) reasons.push("mint authority not revoked");
  if (info.freezeAuthority) reasons.push("freeze authority not revoked");

  // 2) Holder concentration, counting only wallet-owned accounts.
  //    Pool vaults / bonding curves are owned by programs (PDAs), so they are excluded.
  const supply = Number((await rpc("getTokenSupply", [mint]))?.value?.uiAmount ?? 0);
  const largest = ((await rpc("getTokenLargestAccounts", [mint]))?.value ?? []).slice(0, 20);
  const jp = { encoding: "jsonParsed" };
  const tokenAccs = largest.length
    ? (await rpc("getMultipleAccounts", [largest.map((a) => a.address), jp]))?.value ?? []
    : [];
  const owners = tokenAccs.map((a) => a?.data?.parsed?.info?.owner ?? null);
  const ownerKeys = [...new Set(owners.filter(Boolean))];
  const noData = { encoding: "base64", dataSlice: { offset: 0, length: 0 } };
  const ownerInfo = ownerKeys.length
    ? (await rpc("getMultipleAccounts", [ownerKeys, noData]))?.value ?? []
    : [];
  const isWallet = new Map(ownerKeys.map((k, i) => [k, ownerInfo[i]?.owner === SYSTEM_PROGRAM]));

  const wallets = largest
    .map((a, i) => ({ amt: Number(a.uiAmount ?? 0), wallet: isWallet.get(owners[i]) === true }))
    .filter((h) => h.wallet)
    .slice(0, 10);
  const top10Pct = supply > 0 ? (wallets.reduce((s, h) => s + h.amt, 0) / supply) * 100 : 100;
  if (top10Pct > gateCfg.maxTop10Pct) {
    reasons.push(`top10 wallets hold ${top10Pct.toFixed(1)}% (> ${gateCfg.maxTop10Pct}%)`);
  }

  return { pass: reasons.length === 0, reasons, top10Pct: Number(top10Pct.toFixed(1)) };
}
