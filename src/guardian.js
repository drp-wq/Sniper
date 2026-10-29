import { existsSync } from "node:fs";
import { cfg } from "./config.js";
import { log } from "./log.js";
import { openCount, isOpen, getDailyRealizedPnl } from "./paper.js";

export const RiskGuardian = {
  evaluate(signal, context = {}) {
    const now = context.now ?? Date.now();
    const halt = context.halt ?? existsSync("HALT");
    const count = context.openCount ?? openCount();
    const open = context.isOpen !== undefined ? context.isOpen : isOpen(signal?.mint);
    const dailyLoss = context.dailyLoss ?? getDailyRealizedPnl();
    const maxDailyLoss = Number(cfg.maxDailyLossPct ?? 50);

    // 1. Mandatory Paper Safety Invariants
    if (!cfg.paper || !cfg.dryRun || cfg.liveTradingEnabled) {
      const decision = {
        allow: false,
        reason: "live_trading_forbidden",
        explanation: "Live trading is strictly prohibited. System operates paper-only.",
      };
      log("guardian_veto", { mint: signal?.mint, ...decision });
      return decision;
    }

    // 2. KillSwitch Veto
    if (halt) {
      const decision = {
        allow: false,
        reason: "kill_switch_active",
        explanation: "KillSwitch is engaged; all new paper entries blocked.",
      };
      log("guardian_veto", { mint: signal?.mint, ...decision });
      return decision;
    }

    // 3. Stale Signal Veto
    const ageMs = now - (signal?.ts || now);
    if (ageMs > cfg.maxSignalAgeMs) {
      const decision = {
        allow: false,
        reason: "stale_signal",
        explanation: `Signal age (${Math.round(ageMs / 1000)}s) exceeds max threshold (${cfg.maxSignalAgeMs / 1000}s).`,
        ageMs,
      };
      log("guardian_veto", { mint: signal?.mint, ...decision });
      return decision;
    }

    // 4. Position Limit Veto
    if (count >= cfg.maxOpen) {
      const decision = {
        allow: false,
        reason: "max_open_reached",
        explanation: `Open positions count (${count}) has reached maximum limit (${cfg.maxOpen}).`,
        count,
      };
      log("guardian_veto", { mint: signal?.mint, ...decision });
      return decision;
    }

    // 5. Duplicate Position Veto
    if (open) {
      const decision = {
        allow: false,
        reason: "already_open",
        explanation: `Paper position for mint ${signal?.mint} is already open.`,
      };
      log("guardian_veto", { mint: signal?.mint, ...decision });
      return decision;
    }

    // 6. Daily Paper Loss Limit Veto
    if (dailyLoss <= -maxDailyLoss) {
      const decision = {
        allow: false,
        reason: "daily_loss_limit_exceeded",
        explanation: `Realized paper loss today (${dailyLoss.toFixed(1)}%) reached safety limit (-${maxDailyLoss}%).`,
        dailyLoss,
      };
      log("guardian_veto", { mint: signal?.mint, ...decision });
      return decision;
    }

    return {
      allow: true,
      reason: "approved",
      explanation: "Signal cleared all pre-entry risk checks.",
    };
  },
};
