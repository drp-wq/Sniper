/**
 * Portfolio Sizing & Capital Allocation Module
 * Implements Fixed Fraction and Capped Fractional Kelly Sizing
 * with strict fail-safe caps and drawdown dampening.
 */

/**
 * Computes trade allocation size using Capped Fractional Kelly criterion.
 * 
 * Formula:
 *   Kelly f* = (p * (b + 1) - 1) / b
 *   Adjusted f = clamp(kellyFraction * f*, 0, maxExposureFraction)
 * 
 * @param {Object} params
 * @param {number} params.capital - Total available portfolio equity ($)
 * @param {number} params.winRate - Historical win rate (0.0 to 1.0)
 * @param {number} params.avgWin - Average win percentage or payoff (>0)
 * @param {number} params.avgLoss - Average loss percentage (>0)
 * @param {number} [params.kellyFraction=0.25] - Fractional Kelly dampener (default quarter-Kelly: 0.25)
 * @param {number} [params.maxExposureFraction=0.02] - Maximum portfolio allocation per trade (default 2%)
 * @param {number} [params.currentDailyLoss=0] - Current daily loss amount (positive number or negative PnL)
 * @param {number} [params.maxDailyLoss=0.50] - Daily drawdown limit as fraction of capital
 * @returns {Object} Sizing verdict with allocatedUsd, fraction, and explanation
 */
export function computeKellySize({
  capital,
  winRate,
  avgWin,
  avgLoss,
  kellyFraction = 0.25,
  maxExposureFraction = 0.02,
  currentDailyLoss = 0,
  maxDailyLoss = 0.50,
}) {
  // 1. Sanity & fail-closed input guards
  if (!Number.isFinite(capital) || capital <= 0) {
    return { allocatedUsd: 0, fraction: 0, reason: "invalid_capital" };
  }
  if (!Number.isFinite(winRate) || winRate <= 0 || winRate >= 1) {
    return { allocatedUsd: 0, fraction: 0, reason: "invalid_winrate" };
  }
  if (!Number.isFinite(avgWin) || avgWin <= 0 || !Number.isFinite(avgLoss) || avgLoss <= 0) {
    return { allocatedUsd: 0, fraction: 0, reason: "invalid_payoff_stats" };
  }

  // 2. Daily Drawdown Dampener
  const dailyLossPct = Math.abs(currentDailyLoss) / capital;
  if (dailyLossPct >= maxDailyLoss) {
    return { allocatedUsd: 0, fraction: 0, reason: "daily_drawdown_limit_reached" };
  }

  // Scale down capital exposure linearly as daily loss approaches limit
  const drawdownSafetyScale = Math.max(0, 1 - (dailyLossPct / maxDailyLoss));

  // 3. Raw Kelly calculation
  const b = avgWin / avgLoss; // Payoff ratio
  const rawKelly = (winRate * (b + 1) - 1) / b;

  if (rawKelly <= 0) {
    return {
      allocatedUsd: 0,
      fraction: 0,
      rawKelly,
      reason: "negative_expectancy_kelly",
      explanation: `Kelly fraction is non-positive (${rawKelly.toFixed(4)}); no edge.`
    };
  }

  // 4. Fractional Kelly scaling and hard ceiling clamp
  const dampenedKelly = rawKelly * kellyFraction * drawdownSafetyScale;
  const finalFraction = Math.min(dampenedKelly, maxExposureFraction);
  const allocatedUsd = Number((capital * finalFraction).toFixed(2));

  return {
    allocatedUsd,
    fraction: Number(finalFraction.toFixed(4)),
    rawKelly: Number(rawKelly.toFixed(4)),
    drawdownSafetyScale: Number(drawdownSafetyScale.toFixed(2)),
    reason: "approved"
  };
}

/**
 * Computes fixed fractional size with drawdown dampening.
 * 
 * @param {Object} params
 * @param {number} params.capital - Total available portfolio equity ($)
 * @param {number} [params.fixedFraction=0.01] - Baseline allocation fraction (default 1%)
 * @param {number} [params.maxExposureFraction=0.02] - Hard maximum fraction (default 2%)
 * @param {number} [params.currentDailyLoss=0] - Current daily loss amount
 * @param {number} [params.maxDailyLoss=0.50] - Daily drawdown limit as fraction
 * @returns {Object} Sizing verdict
 */
export function computeFixedFractionSize({
  capital,
  fixedFraction = 0.01,
  maxExposureFraction = 0.02,
  currentDailyLoss = 0,
  maxDailyLoss = 0.50,
}) {
  if (!Number.isFinite(capital) || capital <= 0) {
    return { allocatedUsd: 0, fraction: 0, reason: "invalid_capital" };
  }

  const dailyLossPct = Math.abs(currentDailyLoss) / capital;
  if (dailyLossPct >= maxDailyLoss) {
    return { allocatedUsd: 0, fraction: 0, reason: "daily_drawdown_limit_reached" };
  }

  const drawdownSafetyScale = Math.max(0, 1 - (dailyLossPct / maxDailyLoss));
  const finalFraction = Math.min(fixedFraction * drawdownSafetyScale, maxExposureFraction);
  const allocatedUsd = Number((capital * finalFraction).toFixed(2));

  return {
    allocatedUsd,
    fraction: Number(finalFraction.toFixed(4)),
    drawdownSafetyScale: Number(drawdownSafetyScale.toFixed(2)),
    reason: "approved"
  };
}
