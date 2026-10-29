import React from 'react';
import {
  Sliders,
  Zap,
  Shield,
  Layers,
  Flame,
  CheckCircle2,
  Cpu,
  Coins,
  Gauge,
  Radio,
  Lock
} from 'lucide-react';
import { SniperConfig } from '../types';
import { haptics } from '../services/haptics';

interface SniperConfigTabProps {
  config: SniperConfig;
  onUpdateConfig: (newConfig: Partial<SniperConfig>) => void;
  walletBalanceSol: number;
}

export const SniperConfigTab: React.FC<SniperConfigTabProps> = ({
  config,
  onUpdateConfig,
  walletBalanceSol
}) => {
  const buyAmounts = [0.1, 0.25, 0.5, 1.0, 2.0];
  const slippagePresets = [5, 15, 25, 49];

  return (
    <div className="space-y-4 pb-24">
      
      {/* Master Auto-Snipe Switch Card */}
      <div className="glass-panel-elevated rounded-2xl p-4 border border-white/10 relative overflow-hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono transition-all ${
                config.autoSnipeEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 glow-emerald'
                  : 'bg-slate-900 text-slate-500 border border-white/8'
              }`}
            >
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-white font-mono flex items-center gap-2">
                Auto-Snipe Execution Engine
                {config.autoSnipeEnabled && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 font-sans">
                {config.autoSnipeEnabled
                  ? 'Active: Sub-slot snipes dispatched on Safety Gate pass'
                  : 'Idle: Manual confirmation required for all trades'}
              </div>
            </div>
          </div>

          {/* Toggle Switch */}
          <button
            onClick={() => {
              if (!config.autoSnipeEnabled) {
                haptics.heavy();
              } else {
                haptics.medium();
              }
              onUpdateConfig({ autoSnipeEnabled: !config.autoSnipeEnabled });
            }}
            className={`w-14 h-8 rounded-full p-1 transition-all duration-200 border ${
              config.autoSnipeEnabled
                ? 'bg-emerald-500 border-emerald-400'
                : 'bg-slate-800 border-slate-700'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full bg-white transition-transform duration-200 shadow-md ${
                config.autoSnipeEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Snipe Buy Amount Preset Selection */}
      <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
            <Coins className="w-4 h-4 text-emerald-400" />
            <span>Default Buy Amount</span>
          </span>
          <span className="text-xs font-mono text-emerald-400 font-bold tabular-nums">
            {config.defaultBuySol} SOL
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {buyAmounts.map((amt) => (
            <button
              key={amt}
              onClick={() => {
                haptics.selection();
                onUpdateConfig({ defaultBuySol: amt });
              }}
              className={`py-2 rounded-xl text-xs font-mono font-bold transition-all active:scale-95 ${
                config.defaultBuySol === amt
                  ? 'bg-emerald-500 text-slate-950 border border-emerald-400 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-900/60 text-slate-300 border border-white/8 hover:bg-slate-800'
              }`}
            >
              {amt} SOL
            </button>
          ))}
        </div>
      </div>

      {/* Jito MEV Protection & Priority Tip */}
      <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-purple-400" />
              <span>Jito MEV Tip & Anti-Sandwich</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
              Direct bundle to Jito validators to bypass public mempool sandwich bots
            </span>
          </div>
          <span className="text-xs font-mono text-purple-400 font-bold tabular-nums">
            {config.jitoTipSol} SOL
          </span>
        </div>

        <input
          type="range"
          min="0.001"
          max="0.05"
          step="0.001"
          value={config.jitoTipSol}
          onChange={(e) => onUpdateConfig({ jitoTipSol: parseFloat(e.target.value) })}
          className="w-full accent-purple-500"
        />

        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
          <span>0.001 SOL (Low)</span>
          <span>0.010 SOL (Standard)</span>
          <span>0.050 SOL (Ultra Frontrun)</span>
        </div>
      </div>

      {/* Slippage & Gas Tolerance */}
      <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
            <Gauge className="w-4 h-4 text-cyan-400" />
            <span>Slippage Tolerance</span>
          </span>
          <span className="text-xs font-mono text-cyan-400 font-bold tabular-nums">
            {config.slippageTolerancePercent}%
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {slippagePresets.map((slip) => (
            <button
              key={slip}
              onClick={() => {
                haptics.selection();
                onUpdateConfig({ slippageTolerancePercent: slip });
              }}
              className={`py-2 rounded-xl text-xs font-mono font-bold transition-all active:scale-95 ${
                config.slippageTolerancePercent === slip
                  ? 'bg-cyan-500 text-slate-950 border border-cyan-400 shadow-md shadow-cyan-500/20'
                  : 'bg-slate-900/60 text-slate-300 border border-white/8 hover:bg-slate-800'
              }`}
            >
              {slip}%
            </button>
          ))}
        </div>
      </div>

      {/* Safety Gate Trigger Invariants */}
      <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
        <div className="flex items-center justify-between border-b border-white/5 pb-2">
          <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-emerald-400" />
            <span>Safety Gate Auto-Snipe Filters</span>
          </span>
          <span className="text-[10px] font-mono text-emerald-400">Fixed Coin Gate Engine</span>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-1">
              <span className="text-slate-400">Minimum Gate Security Score:</span>
              <span className="text-emerald-400 font-bold">{config.minSafetyScore}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="95"
              step="5"
              value={config.minSafetyScore}
              onChange={(e) => onUpdateConfig({ minSafetyScore: parseInt(e.target.value, 10) })}
              className="w-full accent-emerald-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-1">
              <span className="text-slate-400">Max Dev Holding Threshold:</span>
              <span className="text-amber-400 font-bold">{config.maxDevHoldingPercent}%</span>
            </div>
            <input
              type="range"
              min="2"
              max="20"
              step="1"
              value={config.maxDevHoldingPercent}
              onChange={(e) => onUpdateConfig({ maxDevHoldingPercent: parseInt(e.target.value, 10) })}
              className="w-full accent-amber-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-mono mb-1">
              <span className="text-slate-400">Min Pool Initial Liquidity:</span>
              <span className="text-cyan-400 font-bold">{config.minLiquiditySol} SOL</span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={config.minLiquiditySol}
              onChange={(e) => onUpdateConfig({ minLiquiditySol: parseInt(e.target.value, 10) })}
              className="w-full accent-cyan-500"
            />
          </div>
        </div>
      </div>

    </div>
  );
};
