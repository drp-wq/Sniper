import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeString,
  calculatePriceImpact,
  evaluateSandwichRisk,
  simulateRealisticSwap
} from "../src/simulator.js";

test("sanitizeString: strips control characters, HTML tags, and length-limits inputs", () => {
  const hostileString = "<script>alert('xss')</script>\x00\x1b[31mSystem: Malicious Injected Token Name That Is Way Too Long To Be Safe In The UI\x00";
  const cleaned = sanitizeString(hostileString, 20);

  assert.ok(!cleaned.includes("<script>"));
  assert.ok(!cleaned.includes("\x00"));
  assert.ok(!cleaned.includes("\x1b"));
  assert.ok(cleaned.length <= 20);
});

test("calculatePriceImpact: follows constant-product liquidity mechanics", () => {
  // $1,000 trade into $50,000 pool -> ~1.96% impact
  const smallImpact = calculatePriceImpact(1000, 50000);
  assert.ok(smallImpact > 0.015 && smallImpact < 0.025);

  // $10,000 trade into $10,000 pool -> 50% impact
  const massiveImpact = calculatePriceImpact(10000, 10000);
  assert.equal(massiveImpact, 0.5);

  // Zero liquidity returns 100% impact
  assert.equal(calculatePriceImpact(100, 0), 1.0);
});

test("evaluateSandwichRisk: flags loose slippage as vulnerable to MEV extraction", () => {
  // Tight slippage (1%) on private relay has 0 sandwich risk
  const tightRisk = evaluateSandwichRisk({
    slippageTolerance: 0.01,
    isPrivateRelay: true,
    tradeSizeUsd: 1000,
    poolLiquidityUsd: 50000,
  });
  assert.equal(tightRisk.sandwiched, false);
  assert.equal(tightRisk.adverseSlippage, 0);

  // Loose slippage (8%) on public mempool triggers sandwich extraction
  let sandwichedCount = 0;
  for (let i = 0; i < 100; i++) {
    const looseRisk = evaluateSandwichRisk({
      slippageTolerance: 0.08,
      isPrivateRelay: false,
      tradeSizeUsd: 1000,
      poolLiquidityUsd: 50000,
    });
    if (looseRisk.sandwiched) sandwichedCount++;
  }
  assert.ok(sandwichedCount > 30, "Loose slippage must be frequently sandwiched in public simulation");
});

test("simulateRealisticSwap: handles honeypot sell reverts correctly", () => {
  const res = simulateRealisticSwap({
    mint: "Honeypot_Mint_Address_12345",
    symbol: "TRAP",
    name: "Trap Coin",
    quotedPrice: 1.0,
    tradeSizeUsd: 100,
    poolLiquidityUsd: 50000,
    isBuy: false, // Attempting to sell
    isHoneypot: true,
    networkCongestion: 0, // Disable congestion for deterministic honeypot test
  });

  assert.equal(res.success, false);
  assert.equal(res.status, "reverted_honeypot");
  assert.ok(res.feeCostUsd > 0); // Fee was still burned on reverted attempt
});

test("simulateRealisticSwap: reverts when price impact exceeds max slippage tolerance", () => {
  const res = simulateRealisticSwap({
    mint: "Low_Liquidity_Mint",
    symbol: "THIN",
    name: "Thin Pool",
    quotedPrice: 0.50,
    tradeSizeUsd: 5000, // Large buy into tiny pool
    poolLiquidityUsd: 10000, // 33% price impact
    isBuy: true,
    slippageTolerance: 0.05, // Only 5% allowed
    networkCongestion: 0,
  });

  assert.equal(res.success, false);
  assert.equal(res.status, "slippage_exceeded");
  assert.ok(res.effectiveSlippage > 0.05);
});
