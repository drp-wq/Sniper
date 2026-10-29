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

test("SolanaRpc.runOnChainGate regression: supply initialization does not throw ReferenceError for info", async () => {
  const { SolanaRpc } = await import("../dashboard/src/services/solanaRpc.ts");
  const config = { rpcUrl: "https://solana-rpc.publicnode.com", maxTop10Pct: 35 };

  const mockRpc = async (rpcUrl, method, params) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          data: {
            parsed: {
              type: "mint",
              info: {
                mintAuthority: null,
                freezeAuthority: null,
                isInitialized: true,
                supply: "1000000000",
                decimals: 6,
              },
            },
          },
        },
      };
    }
    if (method === "getTokenLargestAccounts") {
      return {
        value: [
          { address: "Acc1", amount: "100000000", decimals: 6 },
        ],
      };
    }
    if (method === "getMultipleAccounts") {
      const keys = params[0];
      if (keys.includes("Acc1")) {
        return {
          value: [{ data: { parsed: { info: { owner: "HolderWallet1" } } } }],
        };
      }
      return {
        value: [{ owner: SYSTEM_PROGRAM }],
      };
    }
    return { value: [] };
  };

  const verdict = await SolanaRpc.runOnChainGate(config, "CleanMint1111111111111111111111111111111111", { callRpc: mockRpc });

  assert.equal(verdict.passed, true);
  assert.equal(verdict.supply, 1000);
  assert.equal(verdict.reasons.length, 0);
  assert.ok(!verdict.reasons.some((r) => r.includes("info is not defined")));
});

test("runGate: rejects when account is a token account rather than a mint", async () => {
  const gateCfg = { maxTop10Pct: 35 };

  const mockRpc = async (method) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          data: {
            parsed: {
              type: "account",
              info: {
                isNative: false,
                mint: "So11111111111111111111111111111111111111112",
                owner: "Wallet11111111111111111111111111111111111111",
                state: "initialized",
                tokenAmount: { amount: "1000", decimals: 6, uiAmount: 0.001 },
              },
            },
          },
        },
      };
    }
    return { value: [] };
  };

  const res = await runGate("TokenAccountInsteadOfMint", gateCfg, mockRpc);
  assert.equal(res.pass, false);
  assert.ok(res.reasons.some((r) => r.includes("not a parsed SPL mint")));
});

test("SolanaRpc.runOnChainGate: rejects when account is a token account rather than a mint", async () => {
  const { SolanaRpc } = await import("../dashboard/src/services/solanaRpc.ts");
  const config = { rpcUrl: "https://solana-rpc.publicnode.com", maxTop10Pct: 35 };

  const mockRpc = async (rpcUrl, method) => {
    if (method === "getAccountInfo") {
      return {
        value: {
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          data: {
            parsed: {
              type: "account",
              info: {
                isNative: false,
                mint: "So11111111111111111111111111111111111111112",
                owner: "Wallet11111111111111111111111111111111111111",
                state: "initialized",
                tokenAmount: { amount: "1000", decimals: 6, uiAmount: 0.001 },
              },
            },
          },
        },
      };
    }
    return { value: [] };
  };

  const verdict = await SolanaRpc.runOnChainGate(config, "TokenAccountInsteadOfMint", { callRpc: mockRpc });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.reasons.some((r) => r.includes("Account is not a SPL mint")));
});

test("runGate: sanitizes wrapped url mint and passes cleanMint to supply and largest accounts", async () => {
  const gateCfg = { maxTop10Pct: 35 };
  const requestedMethods = [];

  const mockRpc = async (method, params) => {
    requestedMethods.push({ method, param: params[0] });
    if (method === "getAccountInfo") {
      return {
        value: {
          data: {
            parsed: {
              type: "mint",
              info: {
                mintAuthority: null,
                freezeAuthority: null,
                supply: "1000000000",
                decimals: 6,
              },
            },
          },
        },
      };
    }
    if (method === "getTokenSupply") return { value: { uiAmount: 1000 } };
    if (method === "getTokenLargestAccounts") return { value: [] };
    return { value: [] };
  };

  const rawUrlMint = "https://dexscreener.com/solana/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  const res = await runGate(rawUrlMint, gateCfg, mockRpc);
  assert.equal(res.pass, true);

  // All RPC queries must have received the sanitized base58 mint, not the URL
  for (const call of requestedMethods) {
    if (Array.isArray(call.param)) continue;
    assert.equal(call.param, "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
  }
});
