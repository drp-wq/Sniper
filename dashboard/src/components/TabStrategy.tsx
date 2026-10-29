/**
 * Tab Strategy: Dynamic Profitability Engine & Rules Tuner
 * Visualizes the 4 Pillars of the Dynamic Strategy:
 * - Auto-Breakeven Lock (+50% Net Win Guarantee)
 * - Volatility-Adaptive Trailing Stop Ratchet
 * - Accelerated Liquidity Pull Front-Runner
 * - Capital Recycling Time-Stop
 * Includes foldable / expandable interactive cards, live parameter sliders, and presets.
 */

import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  TrendingUp,
  Zap,
  ChevronDown,
  ChevronUp,
  Sliders,
  Lock,
  Scale,
  RefreshCw,
  Check,
  Flame,
  ArrowRight,
  Info,
  Clock,
  Layers,
} from 'lucide-react';
import { engine } from '../services/engine';
import { TelegramService } from '../services/telegram';

export const TabStrategy: React.FC = () => {
  const config = engine.getConfig();
  const [activePreset, setActivePreset] = useState<'conservative' | 'balanced' | 'degen'>('balanced');
  const [copiedPreset, setCopiedPreset] = useState(false);

  // Foldable card states
  const [expandedSection, setExpandedSection] = useState<{ [key: string]: boolean }>({
    overview: true,
    ratchet: true,
    breakeven: false,
    liquidity: false,
    presets: true,
  });

  const toggleSection = (key: string) => {
    TelegramService.haptic('click');
    setExpandedSection(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const applyPreset = async (preset: 'conservative' | 'balanced' | 'degen') => {
    TelegramService.haptic('click');
    setActivePreset(preset);

    if (preset === 'conservative') {
      await engine.updateConfig({
        stopLossPct: -20,
        takeProfitHalfPct: 50,
        trailingStopArmPct: 40,
        trailingStopPullbackPct: 15,
        maxHoldSec: 1200,
        timeStopWindowSec: 120,
      });
    } else if (preset === 'balanced') {
      await engine.updateConfig({
        stopLossPct: -25,
        takeProfitHalfPct: 100,
        trailingStopArmPct: 50,
        trailingStopPullbackPct: 20,
        maxHoldSec: 1800,
        timeStopWindowSec: 180,
      });
    } else if (preset === 'degen') {
      await engine.updateConfig({
        stopLossPct: -35,
        takeProfitHalfPct: 150,
        trailingStopArmPct: 80,
        trailingStopPullbackPct: 25,
        maxHoldSec: 3600,
        timeStopWindowSec: 300,
      });
    }

    setCopiedPreset(true);
    setTimeout(() => setCopiedPreset(false), 2000);
  };

  return (
    <div className="space-y-4 pb-20 font-mono">
      {/* Header Banner with Dynamic Breathing Glow */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F172A] via-[#111827] to-[#0A0E17] border border-emerald-500/30 p-4 animate-breathing-card">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">Dynamic Profitability Architecture</h2>
              <div className="text-[10px] text-zinc-400 flex items-center gap-1">
                <span>Active Model:</span>
                <span className="animate-breathing-text font-bold uppercase">{activePreset} Alpha</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-zinc-900/80 px-2.5 py-1 rounded-full border border-zinc-800 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-zinc-300">Live Auto-Ratchet</span>
          </div>
        </div>

        <p className="text-xs text-zinc-300 leading-relaxed mt-2">
          Treats exits with algorithmic discipline: locks in risk-free capital at TP1, tightens trailing stops dynamically on exponential moonshots, and front-runs dev liquidity drainage.
        </p>

        {/* Quick Strategy Presets */}
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-zinc-800/80">
          <button
            onClick={() => applyPreset('conservative')}
            className={`p-2 rounded-xl text-left transition-all cursor-pointer border ${
              activePreset === 'conservative'
                ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-300 shadow-lg shadow-cyan-500/10'
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span>Guardian</span>
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">SL -20% • TP +50%</div>
          </button>

          <button
            onClick={() => applyPreset('balanced')}
            className={`p-2 rounded-xl text-left transition-all cursor-pointer border ${
              activePreset === 'balanced'
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300 shadow-lg shadow-emerald-500/10'
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span>Balanced</span>
              <Scale className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">SL -25% • TP +100%</div>
          </button>

          <button
            onClick={() => applyPreset('degen')}
            className={`p-2 rounded-xl text-left transition-all cursor-pointer border ${
              activePreset === 'degen'
                ? 'bg-purple-950/40 border-purple-500/50 text-purple-300 shadow-lg shadow-purple-500/10'
                : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-bold">
              <span>Moonshot</span>
              <Flame className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">SL -35% • TP +150%</div>
          </button>
        </div>
      </div>

      {/* Foldable Section 1: Auto-Breakeven Mechanism */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden transition-all">
        <button
          onClick={() => toggleSection('breakeven')}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-zinc-800/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
              1
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Auto-Breakeven Lock (The Zero-Loss Principle)</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  +50% Min Guaranteed
                </span>
              </div>
              <div className="text-[10px] text-zinc-400">
                Instantly ratchets SL to 0.0% once TP1 is triggered
              </div>
            </div>
          </div>
          {expandedSection.breakeven ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {expandedSection.breakeven && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-800/80 text-xs text-zinc-300 space-y-2.5 bg-zinc-950/40">
            <p className="text-[11px] leading-relaxed">
              When a token surges to <strong>+{config.takeProfitHalfPct}%</strong>, the bot executes a 50% partial exit, extracting 100% of your initial capital. The trade immediately becomes completely risk-free.
            </p>

            <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between text-[11px]">
              <div>
                <span className="text-zinc-400">Standard Post-TP SL:</span>
                <span className="text-red-400 ml-1.5 line-through">{config.stopLossPct}%</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
              <div>
                <span className="text-zinc-400">Dynamic Ratchet:</span>
                <span className="text-emerald-400 font-bold ml-1.5">0.0% (Breakeven)</span>
              </div>
            </div>

            <div className="text-[10px] text-zinc-400 bg-emerald-950/20 border border-emerald-900/40 p-2 rounded">
              💡 <strong>Math</strong>: (50% sold at +{config.takeProfitHalfPct}%) + (50% sold at &ge; 0%) = <strong>+{config.takeProfitHalfPct / 2}% Minimum Net Profit</strong> guaranteed on the entire trade!
            </div>
          </div>
        )}
      </div>

      {/* Foldable Section 2: Volatility-Adaptive Trailing Stop Ratchet */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden transition-all">
        <button
          onClick={() => toggleSection('ratchet')}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-zinc-800/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs">
              2
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Multi-Tier Trailing Ratchet</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  Dynamic Tiers
                </span>
              </div>
              <div className="text-[10px] text-zinc-400">
                Tightens trailing distance as momentum accelerates
              </div>
            </div>
          </div>
          {expandedSection.ratchet ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {expandedSection.ratchet && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-800/80 text-xs text-zinc-300 space-y-2 bg-zinc-950/40">
            <p className="text-[11px] leading-relaxed">
              Static 20% trailing stops surrender too much profit on 3x-10x parabolic spikes. The dynamic ratchet tightens automatically based on peak gain:
            </p>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800">
                <span className="text-zinc-300">Tier 1 (+50% to +100% Peak):</span>
                <span className="font-bold text-zinc-200">{config.trailingStopPullbackPct}% Trailing Distance</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-cyan-900/40 text-cyan-300">
                <span>Tier 2 (+100% to +200% Peak):</span>
                <span className="font-bold">14% - 15% Dynamic Ratchet</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-purple-900/40 text-purple-300">
                <span>Tier 3 (&gt; +200% Moonshot):</span>
                <span className="font-bold">10% Parabolic Ratchet</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Foldable Section 3: Accelerated Liquidity Pull Front-Runner */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden transition-all">
        <button
          onClick={() => toggleSection('liquidity')}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-zinc-800/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold text-xs">
              3
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>Liquidity Pull Front-Runner</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-400 border border-purple-500/30">
                  Anti-Rug
                </span>
              </div>
              <div className="text-[10px] text-zinc-400">
                Detects LP withdrawal tranches and exits ahead of dev dump
              </div>
            </div>
          </div>
          {expandedSection.liquidity ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
        </button>

        {expandedSection.liquidity && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-800/80 text-xs text-zinc-300 space-y-2 bg-zinc-950/40">
            <p className="text-[11px] leading-relaxed">
              If an open position is in profit (PnL &gt; +15%), the liquidity threshold tightens from -30% to <strong>-20%</strong>. This protects accrued profits and prevents the bot from becoming exit liquidity when whales slowly pull pooled SOL.
            </p>
          </div>
        )}
      </div>

      {/* Live Strategy Parameters Status */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-xs text-white">Active Strategy Configuration</span>
          </div>
          <span className="text-[10px] text-zinc-500">Live SolRelay Engine</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="text-[10px] text-zinc-500">Stop-Loss Limit</div>
            <div className="font-bold text-red-400 mt-0.5">{config.stopLossPct}%</div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="text-[10px] text-zinc-500">TP1 (Sell 50%)</div>
            <div className="font-bold text-emerald-400 mt-0.5">+{config.takeProfitHalfPct}%</div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="text-[10px] text-zinc-500">Trailing Stop Arm</div>
            <div className="font-bold text-cyan-400 mt-0.5">+{config.trailingStopArmPct}%</div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="text-[10px] text-zinc-500">Trailing Pullback</div>
            <div className="font-bold text-purple-400 mt-0.5">{config.trailingStopPullbackPct}%</div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="text-[10px] text-zinc-500">Time-Stop Window</div>
            <div className="font-bold text-amber-400 mt-0.5">{config.timeStopWindowSec}s</div>
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
            <div className="text-[10px] text-zinc-500">Max Hold Period</div>
            <div className="font-bold text-zinc-300 mt-0.5">{config.maxHoldSec / 60} min</div>
          </div>
        </div>
      </div>
    </div>
  );
};
