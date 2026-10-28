/**
 * Benchmark Dataset & Test Tokens for Sniper Bot
 * Provides 200 realistic benchmark paper trades matching the exact schema
 * to evaluate the 200-trade evaluation gate and 2x slippage stress model.
 */

import { ClosedTrade, ExitReason } from '../types';

export const SAMPLE_TEST_MINTS = [
  {
    name: 'Wrapped SOL (Baseline Clean)',
    mint: 'So11111111111111111111111111111111111111112',
    expected: 'PASS',
  },
  {
    name: 'Jupiter (JUP)',
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    expected: 'PASS',
  },
  {
    name: 'Bonk (BONK)',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    expected: 'PASS',
  },
  {
    name: 'dogwifhat (WIF)',
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    expected: 'PASS',
  },
  {
    name: 'USDC (Active Freeze Authority)',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    expected: 'REJECT (Freeze Authority Active)',
  },
];

export function generateBenchmarkTrades(count = 200): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  const now = Date.now();
  const startTime = now - count * 15 * 60 * 1000; // spread over past several days

  const symbols = ['NEO', 'SOLX', 'PEPE', 'ALPHA', 'PUMP', 'AI16Z', 'GIGA', 'FWOG', 'MOODENG', 'CHILL', 'GOAT', 'ACT', 'ZEREBRO', 'RIF', 'LUCE'];
  const exitReasons: ExitReason[] = [
    'trailing_stop',
    'trailing_stop',
    'stop_loss',
    'stop_loss',
    'time_stop',
    'take_profit_half' as any, // folded into trailing_stop
    'liquidity_drop',
    'max_hold',
  ];

  for (let i = 0; i < count; i++) {
    const sym = symbols[i % symbols.length];
    const openedAt = startTime + i * 14 * 60 * 1000;
    const holdSeconds = Math.floor(60 + Math.random() * 1500);
    const closedAt = openedAt + holdSeconds * 1000;

    const basePrice = 0.00001 * Math.pow(10, Math.random() * 3);
    const entrySlip = 0.05;
    const exitSlip = 0.08;
    const entryPriceRaw = basePrice;
    const entryPrice = entryPriceRaw * (1 + entrySlip);

    // Realistic distribution: ~45% win rate, but runners with 100%-300% gains yield positive mean and median
    const roll = Math.random();
    let rawMultiplier = 1;
    let exitReason: ExitReason = 'stop_loss';
    let tookHalf = false;

    if (roll < 0.28) {
      // Big Winner (runner + trailing stop)
      rawMultiplier = 1.6 + Math.random() * 2.2; // +60% to +280%
      exitReason = 'trailing_stop';
      tookHalf = rawMultiplier >= 2.0;
    } else if (roll < 0.44) {
      // Moderate Winner
      rawMultiplier = 1.15 + Math.random() * 0.45; // +15% to +60%
      exitReason = 'trailing_stop';
    } else if (roll < 0.72) {
      // Standard Stop Loss (-25%)
      rawMultiplier = 0.75 - Math.random() * 0.05; // -25% to -30%
      exitReason = 'stop_loss';
    } else if (roll < 0.86) {
      // Time Stop (stuck [-10%, +15%])
      rawMultiplier = 0.92 + Math.random() * 0.18; // -8% to +10%
      exitReason = 'time_stop';
    } else if (roll < 0.95) {
      // Liquidity Drop
      rawMultiplier = 0.65 + Math.random() * 0.2;
      exitReason = 'liquidity_drop';
    } else {
      // Max hold (30m)
      rawMultiplier = 0.9 + Math.random() * 0.25;
      exitReason = 'max_hold';
    }

    const exitPriceRaw = entryPriceRaw * rawMultiplier;
    const exitPrice = exitPriceRaw * (1 - exitSlip);

    // Calculate 1x slippage PnL %
    // If tookHalf is true, 50% was closed at +100% (rawMultiplier 2.0) and 50% at current exitPrice
    let pnlPct1x = ((exitPrice - entryPrice) / entryPrice) * 100;
    let bankedUsd = 0;
    const stake = 100;

    if (tookHalf) {
      const halfProfit = 50 * (2.0 * (1 - exitSlip) / (1 + entrySlip) - 1);
      const remProfit = 50 * (exitPrice / entryPrice - 1);
      bankedUsd = halfProfit;
      pnlPct1x = halfProfit + remProfit;
    }
    const pnlUsd1x = (stake * pnlPct1x) / 100;

    // 2x Slippage Stress: Entry slip = 10%, Exit slip = 16%
    const entryPrice2x = entryPriceRaw * 1.10;
    const exitPrice2x = exitPriceRaw * (1 - 0.16);
    let pnlPct2x = ((exitPrice2x - entryPrice2x) / entryPrice2x) * 100;
    if (tookHalf) {
      const halfProfit2x = 50 * (2.0 * (1 - 0.16) / 1.10 - 1);
      const remProfit2x = 50 * (exitPrice2x / entryPrice2x - 1);
      pnlPct2x = halfProfit2x + remProfit2x;
    }
    const pnlUsd2x = (stake * pnlPct2x) / 100;

    trades.push({
      id: `trade_${i + 1}_${sym}`,
      mint: `${sym}${i}SolanaMint${Math.random().toString(36).substring(2, 8)}`,
      symbol: sym,
      name: `${sym} Token`,
      openedAt,
      closedAt,
      holdSeconds,
      entryPriceRaw,
      entryPrice,
      exitPriceRaw,
      exitPrice,
      entryLiqUsd: Math.floor(20000 + Math.random() * 80000),
      exitLiqUsd: Math.floor(18000 + Math.random() * 75000),
      exitReason,
      tookHalf,
      bankedUsd,
      pnlPct1x: Math.round(pnlPct1x * 100) / 100,
      pnlUsd1x: Math.round(pnlUsd1x * 100) / 100,
      pnlPct2x: Math.round(pnlPct2x * 100) / 100,
      pnlUsd2x: Math.round(pnlUsd2x * 100) / 100,
    });
  }

  return trades;
}
