import test from "node:test";
import assert from "node:assert/strict";

// Mock localStorage for Node.js test environment before importing dashboard engine
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => mockStorage.get(k) ?? null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

import { computeDoubleSlipPnl } from "../src/paper.js";
import { SolanaRpc } from "../dashboard/src/services/solanaRpc.ts";
import { DexScreenerService } from "../dashboard/src/services/dexScreener.ts";
import { SniperEngine } from "../dashboard/src/services/engine.ts";
import { StorageService } from "../dashboard/src/services/storage.ts";

test("F4 fail-closed holder gate rejects empty list, null owner, unknown extension, and passes clean token", async () => {
  const dummyCfg = {
    rpcUrl: "https://solana-dummy.rpc",
    maxTop10Pct: 35,
    minLiqUsd: 15000,
    pollIntervalMs: 3000,
    priceIntervalMs: 5000,
    maxOpen: 5,
    entrySlip: 0.05,
    exitSlip: 0.08,
    stopLossPct: -25,
    takeProfitHalfPct: 100,
    trailingStopArmPct: 50,
    trailingStopPullbackPct: 20,
    timeStopWindowSec: 180,
    maxHoldSec: 1800,
  };

  const cleanMintInfo = {
    value: {
      owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      data: {
        parsed: {
          type: "mint",
          info: {
            decimals: 6,
            mintAuthority: null,
            freezeAuthority: null,
            isInitialized: true,
            extensions: [
              { extension: "metadataPointer" },
              { extension: "tokenMetadata" },
            ],
          },
        },
      },
    },
  };

  // 1. Empty largestList -> throws -> passed = false
  const emptyListRes = await SolanaRpc.runOnChainGate(
    dummyCfg,
    "mint-empty-largest",
    {
      callRpc: async (_url, method) => {
        if (method === "getAccountInfo") return cleanMintInfo;
        if (method === "getTokenSupply") return { value: { amount: "1000000000", decimals: 6 } };
        if (method === "getTokenLargestAccounts") return { value: [] };
        return { value: [] };
      },
    }
  );
  assert.equal(emptyListRes.passed, false);
  assert.ok(emptyListRes.reasons.some((r) => r.includes("No largest-account data")));

  // 2. Null owner in holder accounts -> throws -> passed = false
  const nullOwnerRes = await SolanaRpc.runOnChainGate(
    dummyCfg,
    "mint-null-owner",
    {
      callRpc: async (_url, method, params) => {
        if (method === "getAccountInfo") return cleanMintInfo;
        if (method === "getTokenSupply") return { value: { amount: "1000000000", decimals: 6 } };
        if (method === "getTokenLargestAccounts") {
          return {
            value: [
              { address: "hold1", amount: "200000000", decimals: 6 },
              { address: "hold2", amount: "100000000", decimals: 6 },
            ],
          };
        }
        if (method === "getMultipleAccounts" && params[1]?.encoding === "jsonParsed") {
          return {
            value: [
              { data: { parsed: { info: { owner: "owner1" } } } },
              { data: { parsed: { info: { owner: null } } } }, // Unparseable owner!
            ],
          };
        }
        return { value: [] };
      },
    }
  );
  assert.equal(nullOwnerRes.passed, false);
  assert.ok(nullOwnerRes.reasons.some((r) => r.includes("Unparseable holder owner")));

  // 3. Unknown Token-2022 extension -> passed = false
  const unknownExtRes = await SolanaRpc.runOnChainGate(
    dummyCfg,
    "mint-unknown-ext",
    {
      callRpc: async (_url, method) => {
        if (method === "getAccountInfo") {
          return {
            value: {
              owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
              data: {
                parsed: {
                  type: "mint",
                  info: {
                    decimals: 6,
                    mintAuthority: null,
                    freezeAuthority: null,
                    isInitialized: true,
                    extensions: [{ extension: "maliciousHiddenAuthority" }],
                  },
                },
              },
            },
          };
        }
        if (method === "getTokenSupply") return { value: { amount: "1000000000", decimals: 6 } };
        if (method === "getTokenLargestAccounts") return { value: [] };
        return { value: [] };
      },
    }
  );
  assert.equal(unknownExtRes.passed, false);
  assert.ok(unknownExtRes.reasons.some((r) => r.includes("unknown/unhandled extension")));

  // 4. Clean token with <= 35% holder concentration -> passed = true
  const cleanPassRes = await SolanaRpc.runOnChainGate(
    dummyCfg,
    "mint-clean-pass",
    {
      callRpc: async (_url, method, params) => {
        if (method === "getAccountInfo") return cleanMintInfo;
        if (method === "getTokenSupply") return { value: { amount: "1000000000", decimals: 6 } };
        if (method === "getTokenLargestAccounts") {
          return {
            value: [
              { address: "vault1", amount: "700000000", decimals: 6 }, // 70% in Raydium AMM V4
              { address: "wallet1", amount: "300000000", decimals: 6 }, // 30% in user wallet
            ],
          };
        }
        if (method === "getMultipleAccounts" && params[1]?.encoding === "jsonParsed") {
          return {
            value: [
              { data: { parsed: { info: { owner: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8" } } } }, // Known AMM
              { data: { parsed: { info: { owner: "WalletAddress111111111111111111111111111111" } } } },
            ],
          };
        }
        if (method === "getMultipleAccounts" && params[1]?.encoding === "base64") {
          return {
            value: [
              { owner: "11111111111111111111111111111111" },
            ],
          };
        }
        return { value: [] };
      },
    }
  );
  assert.equal(cleanPassRes.passed, true);
  assert.equal(cleanPassRes.top10Pct, 30);
});

test("F8 DexScreenerService respects case-sensitivity and returns null when preferredPair is not found", async () => {
  const mockFetch = async () => {
    return {
      ok: true,
      json: async () => ({
        schemaVersion: "1.0.0",
        pairs: [
          {
            chainId: "solana",
            dexId: "raydium",
            pairAddress: "PairDirectAAA",
            baseToken: { address: "MintCaseSensitive111", symbol: "AAA", name: "Token AAA" },
            quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "SOL" },
            priceUsd: "2.50",
            liquidity: { usd: 50000 },
          },
          {
            chainId: "solana",
            dexId: "raydium",
            pairAddress: "PairDirectBBB",
            baseToken: { address: "MintCaseSensitive111", symbol: "AAA", name: "Token AAA" },
            quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "SOL" },
            priceUsd: "2.55",
            liquidity: { usd: 30000 },
          },
        ],
      }),
    };
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    // 1) preferredPair absent -> returns null (does not silently use another pair)
    const absentResult = await DexScreenerService.getQuote("MintCaseSensitive111", "NonExistentPairZZZ");
    assert.equal(absentResult, null);

    // 2) preferredPair present -> chooses that exact pair even if another pair has higher liquidity
    const presentResult = await DexScreenerService.getQuote("MintCaseSensitive111", "PairDirectBBB");
    assert.ok(presentResult !== null);
    assert.equal(presentResult.pairAddress, "PairDirectBBB");
    assert.equal(presentResult.priceUsd, 2.55);

    // 3) Case mismatch in mint address -> returns null
    const caseMismatchResult = await DexScreenerService.getQuote("mintcasesensitive111");
    assert.equal(caseMismatchResult, null);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("F7 half-banked trade pnlPct2x matches CLI computeDoubleSlipPnl exactly", () => {
  const engine = new SniperEngine();
  const entryPriceRaw = 1.0;
  const entrySlip = 0.05;
  const exitSlip = 0.08;
  const exitPriceRaw = 2.4;
  const halfRawPrice = 2.0;

  const pos = {
    id: "test_pos_half",
    mint: "MintHalfTest111",
    symbol: "HALF",
    name: "Half Token",
    openedAt: Date.now() - 60000,
    entryPriceRaw,
    entryPrice: entryPriceRaw * (1 + entrySlip),
    entryLiqUsd: 50000,
    stakeUsd: 100,
    shares: 100 / (entryPriceRaw * (1 + entrySlip)),
    currentQuotePrice: exitPriceRaw,
    currentLiqUsd: 48000,
    executablePrice: exitPriceRaw * (1 - exitSlip),
    unrealizedPnlPct: 0,
    unrealizedPnlUsd: 0,
    peakExecutablePrice: exitPriceRaw * (1 - exitSlip),
    peakPnlPct: 0,
    tookHalf: true,
    halfRawPrice,
    bankedUsd: 50,
    trailingArmed: true,
    missedQuoteTicks: 0,
    isUnresolved: false,
    lastHighAt: Date.now(),
    lastTickAt: Date.now(),
  };

  engine.closePosition(pos, "trailing_stop");
  const closed = engine.getClosedTrades()[0];
  assert.ok(closed);

  const cliDoubleSlipPnl = computeDoubleSlipPnl({
    rawEntryQuote: entryPriceRaw,
    rawExitQuote: exitPriceRaw,
    halfRawPrice,
    tookHalf: true,
    entrySlip,
    exitSlip,
  });

  assert.equal(closed.pnlPct2x, cliDoubleSlipPnl);
});

test("F2 simulated trades are tagged, excluded from stats and exports, and never satisfy evaluation gate", () => {
  const engine = new SniperEngine();
  mockStorage.clear();
  engine.resetData();

  // Populate 205 simulated winning trades
  const trades = [];
  const now = Date.now();
  for (let i = 0; i < 205; i++) {
    trades.push({
      id: `sim_trade_${i}`,
      mint: `SimMint${i}`,
      symbol: `SIM${i}`,
      name: `Simulated Token ${i}`,
      openedAt: now - 10000,
      closedAt: now,
      holdSeconds: 10,
      entryPriceRaw: 1.0,
      entryPrice: 1.05,
      exitPriceRaw: 2.0,
      exitPrice: 1.84,
      entryLiqUsd: 30000,
      exitLiqUsd: 30000,
      exitReason: "trailing_stop",
      tookHalf: false,
      bankedUsd: 0,
      pnlPct1x: 75.24,
      pnlUsd1x: 75.24,
      pnlPct2x: 53.33,
      pnlUsd2x: 53.33,
      simulated: true, // Tagged simulated
    });
  }

  // Inject into engine's closedTrades
  engine.importClosedTrades(trades);

  const stats = engine.getStats();
  // Simulated trades must be completely excluded from getStats
  assert.equal(stats.closedCount, 0);
  assert.equal(stats.winCount, 0);
  assert.equal(stats.evaluationGatePassed, false);

  // StorageService exports must exclude simulated trades
  const exportedJsonl = StorageService.exportPaperJsonl(engine.getClosedTrades());
  assert.equal(exportedJsonl.trim(), "");

  // Export positions must exclude simulated positions
  const exportedPositions = StorageService.exportPositionsJson([
    { id: "pos_sim", mint: "m1", symbol: "s1", name: "n1", openedAt: now, entryPriceRaw: 1, entryPrice: 1.05, entryLiqUsd: 20000, stakeUsd: 100, shares: 95, currentQuotePrice: 1, currentLiqUsd: 20000, executablePrice: 0.92, unrealizedPnlPct: 0, unrealizedPnlUsd: 0, peakExecutablePrice: 0.92, peakPnlPct: 0, tookHalf: false, bankedUsd: 0, trailingArmed: false, missedQuoteTicks: 0, isUnresolved: false, lastHighAt: now, lastTickAt: now, simulated: true },
  ]);
  assert.equal(JSON.parse(exportedPositions).length, 0);
});

test("F3 tickPrices race: position entered mid-await survives, and position manually closed mid-await is not resurrected", async () => {
  const engine = new SniperEngine();
  mockStorage.clear();
  engine.resetData();

  const now = Date.now();
  const posA = {
    id: "pos_A",
    mint: "MintA11111111111111111111111111111111111111",
    symbol: "POSA",
    name: "Position A",
    openedAt: now - 10000,
    entryPriceRaw: 1.0,
    entryPrice: 1.05,
    entryLiqUsd: 30000,
    stakeUsd: 100,
    shares: 95.2,
    currentQuotePrice: 1.0,
    currentLiqUsd: 30000,
    executablePrice: 0.92,
    unrealizedPnlPct: 0,
    unrealizedPnlUsd: 0,
    peakExecutablePrice: 0.92,
    peakPnlPct: 0,
    tookHalf: false,
    bankedUsd: 0,
    trailingArmed: false,
    missedQuoteTicks: 0,
    isUnresolved: false,
    lastHighAt: now,
    lastTickAt: now,
  };

  const posB = {
    id: "pos_B",
    mint: "MintB22222222222222222222222222222222222222",
    symbol: "POSB",
    name: "Position B",
    openedAt: now - 5000,
    entryPriceRaw: 2.0,
    entryPrice: 2.10,
    entryLiqUsd: 40000,
    stakeUsd: 100,
    shares: 47.6,
    currentQuotePrice: 2.0,
    currentLiqUsd: 40000,
    executablePrice: 1.84,
    unrealizedPnlPct: 0,
    unrealizedPnlUsd: 0,
    peakExecutablePrice: 1.84,
    peakPnlPct: 0,
    tookHalf: false,
    bankedUsd: 0,
    trailingArmed: false,
    missedQuoteTicks: 0,
    isUnresolved: false,
    lastHighAt: now,
    lastTickAt: now,
  };

  engine.openPositions = [posA, posB];

  let resolveQuoteA;
  const quotePromiseA = new Promise((r) => {
    resolveQuoteA = r;
  });

  const origGetQuote = DexScreenerService.getQuote;
  DexScreenerService.getQuote = async (mint) => {
    if (mint === posA.mint) {
      await quotePromiseA;
      return {
        mint,
        symbol: "POSA",
        name: "Position A",
        pairAddress: "pairA",
        priceUsd: 1.05,
        liqUsd: 30000,
        updatedAt: Date.now(),
      };
    }
    return {
      mint,
      symbol: "POSB",
      name: "Position B",
      pairAddress: "pairB",
      priceUsd: 2.05,
      liqUsd: 40000,
      updatedAt: Date.now(),
    };
  };

  try {
    // 1) Start ticking posA (it will pause awaiting quotePromiseA)
    const tickTask = engine.tickPrices();

    // 2) Mid-tick: a new position posC is entered concurrently
    const posC = {
      id: "pos_C",
      mint: "MintC33333333333333333333333333333333333333",
      symbol: "POSC",
      name: "Position C",
      openedAt: now,
      entryPriceRaw: 0.5,
      entryPrice: 0.525,
      entryLiqUsd: 25000,
      stakeUsd: 100,
      shares: 190.4,
      currentQuotePrice: 0.5,
      currentLiqUsd: 25000,
      executablePrice: 0.46,
      unrealizedPnlPct: 0,
      unrealizedPnlUsd: 0,
      peakExecutablePrice: 0.46,
      peakPnlPct: 0,
      tookHalf: false,
      bankedUsd: 0,
      trailingArmed: false,
      missedQuoteTicks: 0,
      isUnresolved: false,
      lastHighAt: now,
      lastTickAt: now,
    };
    engine.openPositions.push(posC);

    // 3) Mid-tick: posB is manually closed
    engine.manualClose(posB.id);

    // Verify posB is closed in memory right now
    assert.equal(engine.openPositions.some((p) => p.id === posB.id), false);
    assert.equal(engine.getClosedTrades().length, 1);

    // 4) Resume quotePromiseA and finish tick
    resolveQuoteA();
    await tickTask;

    // Concurrently entered posC MUST SURVIVE
    assert.ok(engine.openPositions.some((p) => p.id === posC.id), "Concurrent position C must survive tick");

    // Manually closed posB MUST NOT BE RESURRECTED
    assert.equal(engine.openPositions.some((p) => p.id === posB.id), false, "Closed position B must not resurrect");

    // Must have produced exactly one closed trade for posB
    const closedB = engine.getClosedTrades().filter((t) => t.mint === posB.mint);
    assert.equal(closedB.length, 1, "Exactly one closed trade produced for B");
  } finally {
    DexScreenerService.getQuote = origGetQuote;
  }
});
