import test from "node:test";
import assert from "node:assert/strict";
import { runGate, inspectMintExtensions } from "../src/gate.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

test("runGate: rejects when mintAuthority or freezeAuthority is not revoked", async () => {
  const gateCfg = { maxTop10Pct: 35 };

  // Mint authority present
  const mockRpcMintAuth = async (method) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          data: {
            parsed: {
              info: {
                mintAuthority: "AuthWallet111111111111111111111111111111",
                freezeAuthority: null,
              },
            },
          },
        },
      };
    }
    if (method === "getTokenSupply") return { value: { uiAmount: 1000000 } };
    if (method === "getTokenLargestAccounts") return { value: [] };
    return { value: [] };
  };

  const res1 = await runGate("Mint1", gateCfg, mockRpcMintAuth);
  assert.equal(res1.pass, false);
  assert.ok(res1.reasons.some((r) => r.includes("mint authority not revoked")));

  // Freeze authority present
  const mockRpcFreezeAuth = async (method) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          data: {
            parsed: {
              info: {
                mintAuthority: null,
                freezeAuthority: "FreezeWallet1111111111111111111111111111",
              },
            },
          },
        },
      };
    }
    if (method === "getTokenSupply") return { value: { uiAmount: 1000000 } };
    if (method === "getTokenLargestAccounts") return { value: [] };
    return { value: [] };
  };

  const res2 = await runGate("Mint2", gateCfg, mockRpcFreezeAuth);
  assert.equal(res2.pass, false);
  assert.ok(res2.reasons.some((r) => r.includes("freeze authority not revoked")));
});

test("runGate: rejects unparsed or invalid mint account", async () => {
  const mockRpc = async () => ({ value: null });
  const res = await runGate("InvalidMint", { maxTop10Pct: 35 }, mockRpc);
  assert.equal(res.pass, false);
  assert.deepEqual(res.reasons, ["not a parsed SPL mint"]);
});

test("inspectMintExtensions: flags dangerous Token-2022 extensions", () => {
  assert.deepEqual(inspectMintExtensions({}), []);

  const dangerousInfo = {
    extensions: [
      { extension: "permanentDelegate", state: { delegate: "SomeHacker111" } },
      { extension: "transferHook", state: { programId: "HookProg111" } },
      { extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 500 } } },
      { extension: "defaultAccountState", state: { state: "frozen" } },
      { extension: "nonTransferable" },
      { extension: "mintCloseAuthority", state: { closeAuthority: "Closer111" } },
      { extension: "pausable", state: { paused: true } },
    ],
  };

  const reasons = inspectMintExtensions(dangerousInfo);
  assert.ok(reasons.includes("permanent delegate active"));
  assert.ok(reasons.includes("transfer hook active"));
  assert.ok(reasons.includes("transfer fee active"));
  assert.ok(reasons.includes("default account state frozen"));
  assert.ok(reasons.includes("non-transferable mint"));
  assert.ok(reasons.includes("mint close authority active"));
  assert.ok(reasons.includes("pausable mint active"));
});

test("runGate: aggregates multi-account wallets and treats unfunded system accounts as wallets", async () => {
  const gateCfg = { maxTop10Pct: 35 };

  // Supply is 1,000,000
  // Largest accounts:
  // Account 1: 500,000 held by Raydium Pool PDA (ownerInfo owner = RaydiumProgramId) -> excluded
  // Account 2: 200,000 held by Wallet A (ownerInfo owner = SYSTEM_PROGRAM)
  // Account 3: 180,000 held by Wallet A again! (same wallet, 2 token accounts!)
  // Account 4: 50,000 held by Wallet B (ownerInfo = null -> unfunded wallet with 0 SOL)
  const RAYDIUM_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

  const mockRpc = async (method, params) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          data: {
            parsed: {
              info: {
                mintAuthority: null,
                freezeAuthority: null,
              },
            },
          },
        },
      };
    }
    if (method === "getTokenSupply") {
      return { value: { uiAmount: 1000000 } };
    }
    if (method === "getTokenLargestAccounts") {
      return {
        value: [
          { address: "TokenAccPool", uiAmount: 500000 },
          { address: "TokenAccA1", uiAmount: 200000 },
          { address: "TokenAccA2", uiAmount: 180000 },
          { address: "TokenAccB", uiAmount: 50000 },
        ],
      };
    }
    if (method === "getMultipleAccounts") {
      const keys = params[0];
      if (keys.includes("TokenAccPool")) {
        // Parsed token accounts
        return {
          value: [
            { data: { parsed: { info: { owner: "RaydiumPoolPDA" } } } },
            { data: { parsed: { info: { owner: "WalletA" } } } },
            { data: { parsed: { info: { owner: "WalletA" } } } },
            { data: { parsed: { info: { owner: "WalletB" } } } },
          ],
        };
      }
      // Owner account infos: ["RaydiumPoolPDA", "WalletA", "WalletB"]
      return {
        value: [
          { owner: RAYDIUM_PROGRAM }, // RaydiumPoolPDA -> program PDA, not wallet
          { owner: SYSTEM_PROGRAM },  // WalletA -> system wallet
          null,                       // WalletB -> null, unfunded wallet (0 lamports)
        ],
      };
    }
    return { value: [] };
  };

  const res = await runGate("TestMintConcentration", gateCfg, mockRpc);
  // Total wallet holdings:
  // Wallet A: 200k + 180k = 380k (38%)
  // Wallet B: 50k (5%)
  // Top 10 wallets sum = 430k / 1,000,000 = 43.0%
  // 43% > 35% => Gate must reject!
  assert.equal(res.pass, false);
  assert.equal(res.top10Pct, 43);
  assert.ok(res.reasons.some((r) => r.includes("top10 wallets hold 43.0% (> 35%)")));
});

test("runGate: passes when authorities are revoked and top-10 concentration is under limit", async () => {
  const gateCfg = { maxTop10Pct: 35 };

  const mockRpc = async (method, params) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          data: {
            parsed: {
              info: {
                mintAuthority: null,
                freezeAuthority: null,
              },
            },
          },
        },
      };
    }
    if (method === "getTokenSupply") return { value: { uiAmount: 1000000 } };
    if (method === "getTokenLargestAccounts") {
      return {
        value: [
          { address: "TokenAccPool", uiAmount: 800000 },
          { address: "TokenAccW1", uiAmount: 100000 },
          { address: "TokenAccW2", uiAmount: 50000 },
        ],
      };
    }
    if (method === "getMultipleAccounts") {
      const keys = params[0];
      if (keys.includes("TokenAccPool")) {
        return {
          value: [
            { data: { parsed: { info: { owner: "PoolPDA" } } } },
            { data: { parsed: { info: { owner: "Wallet1" } } } },
            { data: { parsed: { info: { owner: "Wallet2" } } } },
          ],
        };
      }
      return {
        value: [
          { owner: "SomeProgramPDA1111111111111111111111111" },
          { owner: SYSTEM_PROGRAM },
          { owner: SYSTEM_PROGRAM },
        ],
      };
    }
    return { value: [] };
  };

  const res = await runGate("CleanMint", gateCfg, mockRpc);
  assert.equal(res.pass, true);
  assert.equal(res.reasons.length, 0);
  assert.equal(res.top10Pct, 15); // (100k + 50k) / 1M = 15%
});
