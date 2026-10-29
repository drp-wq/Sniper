import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Flame,
  Zap,
  ShieldCheck,
  TrendingUp,
  Droplets,
  ExternalLink,
  Clock,
  Sparkles,
  Search,
  Filter
} from 'lucide-react';
import { TokenSignal } from '../types';
import { haptics } from '../services/haptics';

interface SignalStreamFeedProps {
  signals: TokenSignal[];
  onQuickAudit: (mint: string) => void;
  onSnipeToken: (signal: TokenSignal) => void;
  isSniperActive: boolean;
  defaultBuySol: number;
}

export const SignalStreamFeed: React.FC<SignalStreamFeedProps> = ({
  signals,
  onQuickAudit,
  onSnipeToken,
  isSniperActive,
  defaultBuySol
}) => {
  const [filter, setFilter] = useState<'all' | 'pump' | 'raydium' | 'safe' | 'high_liq'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSignals = signals.filter((sig) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        sig.symbol.toLowerCase().includes(q) ||
        sig.name.toLowerCase().includes(q) ||
        sig.mint.toLowerCase().includes(q);
      if (!match) return false;
    }

    if (filter === 'pump') return sig.dex === 'Pump.fun';
    if (filter === 'raydium') return sig.dex === 'Raydium';
    if (filter === 'safe') return sig.safetyScore >= 85;
    if (filter === 'high_liq') return sig.initialSolLiquidity >= 50;
    return true;
  });

  return (
    <div className="space-y-3 pb-24">
      {/* Stream Status Banner & Search */}
      <div className="glass-panel rounded-2xl p-3.5 border border-white/8 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 absolute" />
            </div>
            <div>
              <span className="text-xs font-mono font-bold text-white flex items-center gap-1.5">
                Mempool Sub-Slot Signal Stream
              </span>
              <span className="text-[10px] text-slate-400 font-mono block">
                Raydium · Pump.fun · Meteora DLMM
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded-md font-semibold">
              {filteredSignals.length} Active Pools
            </span>
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search symbol, pair or contract..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 transition-all"
          />
        </div>

        {/* Filter Segmented Buttons */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
          {[
            { id: 'all', label: 'All Pools' },
            { id: 'pump', label: 'Pump.fun' },
            { id: 'raydium', label: 'Raydium' },
            { id: 'safe', label: 'Score > 85' },
            { id: 'high_liq', label: 'Liq > 50 SOL' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                haptics.selection();
                setFilter(item.id as typeof filter);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium whitespace-nowrap transition-all active:scale-95 ${
                filter === item.id
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 bg-slate-900/40 border border-white/5'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Signal Cards Feed with Motion Spring Transitions */}
      <div className="space-y-2.5">
        <AnimatePresence mode="popLayout">
          {filteredSignals.map((signal, index) => {
            const isSafe = signal.safetyScore >= 80;
            const isDanger = signal.safetyScore < 40;

            return (
              <motion.div
                key={signal.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
                className={`glass-panel rounded-2xl p-4 border transition-all hover:border-emerald-500/30 ${
                  signal.isSniped
                    ? 'border-emerald-500/50 bg-emerald-950/15'
                    : 'border-white/8 hover:bg-slate-900/60'
                }`}
              >
                {/* Header row: Symbol, Name, DEX badge, Time */}
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center font-mono font-bold text-sm text-emerald-400 shrink-0 shadow-inner">
                      {signal.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white text-sm">
                          ${signal.symbol}
                        </span>
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider"
                          style={{
                            backgroundColor: `${signal.dexColor}20`,
                            color: signal.dexColor,
                            border: `1px solid ${signal.dexColor}40`
                          }}
                        >
                          {signal.dex}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-sans truncate max-w-[160px]">
                        {signal.name}
                      </div>
                    </div>
                  </div>

                  {/* Safety Score Chip */}
                  <div className="flex flex-col items-end">
                    <div
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-mono font-bold ${
                        isSafe
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : isDanger
                          ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                          : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{signal.safetyScore}%</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {signal.detectedSecondsAgo}s ago
                    </span>
                  </div>
                </div>

                {/* Metrics Bar: Liquidity, Price, 5m Delta */}
                <div className="grid grid-cols-3 gap-2 py-2 px-2.5 rounded-xl bg-slate-950/50 border border-white/5 font-mono text-xs mb-3">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase flex items-center gap-1">
                      <Droplets className="w-3 h-3 text-cyan-400" />
                      <span>Pool Liq</span>
                    </div>
                    <div className="text-slate-200 font-bold mt-0.5 tabular-nums">
                      {signal.initialSolLiquidity} SOL
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-slate-500 uppercase">Price USD</div>
                    <div className="text-slate-200 font-bold mt-0.5 tabular-nums truncate">
                      ${signal.priceUsd.toFixed(6)}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 uppercase">5m PnL</div>
                    <div
                      className={`font-bold mt-0.5 tabular-nums ${
                        signal.priceDelta5m >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {signal.priceDelta5m >= 0 ? '+' : ''}
                      {signal.priceDelta5m}%
                    </div>
                  </div>
                </div>

                {/* Mini Sparkline Visualization */}
                <div className="h-6 w-full flex items-end gap-1 mb-3 px-1">
                  {signal.sparkline.map((val, idx) => {
                    const maxVal = Math.max(...signal.sparkline);
                    const minVal = Math.min(...signal.sparkline);
                    const heightPercent = Math.max(15, ((val - minVal) / (maxVal - minVal || 1)) * 100);
                    return (
                      <div
                        key={idx}
                        className="flex-1 rounded-sm bg-gradient-to-t from-emerald-500/20 to-emerald-400/80 transition-all duration-300"
                        style={{ height: `${heightPercent}%` }}
                      />
                    );
                  })}
                </div>

                {/* Card Action Buttons */}
                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                  {/* Quick Audit Action Chip */}
                  <button
                    onClick={() => {
                      haptics.selection();
                      onQuickAudit(signal.mint);
                    }}
                    className="flex-1 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/10 font-mono text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Quick Audit</span>
                  </button>

                  {/* 1-Tap Snipe Button */}
                  <button
                    onClick={() => {
                      haptics.heavy();
                      onSnipeToken(signal);
                    }}
                    disabled={signal.isSniped}
                    className={`flex-1 py-2 px-3 rounded-xl font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 ${
                      signal.isSniped
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 cursor-default'
                        : isDanger
                        ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20 glow-emerald'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>{signal.isSniped ? 'Sniped (In HUD)' : `Snipe ${defaultBuySol} SOL`}</span>
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
