/**
 * Tab 1: Live Dashboard (Command Center)
 * KPI cards, 200-trade evaluation gate banner, performance metrics, and quick scanner controls
 */

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Award,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Square,
  RefreshCw,
  Zap,
  ShieldCheck,
  Percent,
  Database,
  ArrowUpRight,
  Flame,
} from 'lucide-react';
import { engine } from '../services/engine';
import { generateBenchmarkTrades } from '../services/sampleData';

interface TabDashboardProps {
  onNavigateToTab: (tab: any) => void;
}

export const TabDashboard: React.FC<TabDashboardProps> = ({ onNavigateToTab }) => {
  const stats = engine.getStats();
  const config = engine.getConfig();
  const isScannerActive = engine.isScannerActive();
  const isLocalHalted = engine.isLocalHaltActive();
  const isRemoteHalted = engine.isRemoteHaltActive();
  const openPositions = engine.getOpenPositions();
  const signalLogs = engine.getSignalLogs().slice(0, 5);

  const closedTarget = 200;
  const closedProgress = Math.min(100, (stats.closedCount / closedTarget) * 100);

  const handleLoadBenchmark = () => {
    const sample = generateBenchmarkTrades(200);
    engine.loadBenchmarkTrades(sample);
  };

  return (
    <div className="space-y-4 pb-20">
      
      {/* 200-Trade Evaluation Gate Banner */}
      <div
        className={`p-4 rounded-xl border relative overflow-hidden transition-all ${
          stats.evaluationGatePassed
            ? 'bg-gradient-to-r from-emerald-950/60 via-zinc-900 to-emerald-950/40 border-emerald-500/50'
            : stats.closedCount >= closedTarget
            ? 'bg-gradient-to-r from-red-950/60 via-zinc-900 to-red-950/40 border-red-500/50'
            : 'bg-zinc-900/90 border-zinc-800'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`p-2.5 rounded-lg shrink-0 ${
                stats.evaluationGatePassed
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : stats.closedCount >= closedTarget
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
              }`}
            >
              {stats.evaluationGatePassed ? (
                <ShieldCheck className="w-6 h-6" />
              ) : stats.closedCount >= closedTarget ? (
                <XCircle className="w-6 h-6" />
              ) : (
                <Award className="w-6 h-6" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                  Statistical Evaluation Gate (200 Trades)
                </span>
                <span
                  className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                    stats.evaluationGatePassed
                      ? 'bg-emerald-500 text-black'
                      : stats.closedCount >= closedTarget
                      ? 'bg-red-500 text-white'
                      : 'bg-zinc-800 text-zinc-300'
                  }`}
                >
                  {stats.evaluationGatePassed
                    ? 'GATE PASSED'
                    : stats.closedCount >= closedTarget
                    ? 'GATE FAILED'
                    : 'INCOMPLETE GATE'}
                </span>
              </div>

              <div className="text-sm font-semibold text-white mt-1">
                {stats.evaluationGatePassed
                  ? 'Robust Paper Edge: Mean & Median Positive Under Both 1x and 2x Slippage!'
                  : stats.closedCount >= closedTarget
                  ? 'Evaluation Criteria Not Met Under Slippage Stress Model'
                  : `Need ${closedTarget - stats.closedCount} more closed trades to validate edge under 2x slippage`}
              </div>

              <div className="flex items-center gap-3 text-xs text-zinc-400 mt-2 font-mono flex-wrap">
                <span className={stats.closedCount >= 200 ? 'text-emerald-400' : 'text-zinc-500'}>
                  Trades: {stats.closedCount}/{closedTarget}
                </span>
                <span>•</span>
                <span className={stats.meanPnl1x > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  Mean 1x: {stats.meanPnl1x >= 0 ? '+' : ''}{stats.meanPnl1x.toFixed(2)}%
                </span>
                <span>•</span>
                <span className={stats.medianPnl1x > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  Med 1x: {stats.medianPnl1x >= 0 ? '+' : ''}{stats.medianPnl1x.toFixed(2)}%
                </span>
                <span>•</span>
                <span className={stats.meanPnl2x > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  Mean 2x: {stats.meanPnl2x >= 0 ? '+' : ''}{stats.meanPnl2x.toFixed(2)}%
                </span>
                <span>•</span>
                <span className={stats.medianPnl2x > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  Med 2x: {stats.medianPnl2x >= 0 ? '+' : ''}{stats.medianPnl2x.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>

          {/* Quick Action: Pre-load 200 benchmark trades & Simulate Signal */}
          <div className="sm:self-center shrink-0 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => engine.simulateSignal()}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-xs font-mono transition-all cursor-pointer font-semibold"
              title="Inject a test Solana signal through the on-chain gate and paper trader"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Simulate Signal</span>
            </button>

            {stats.closedCount < 200 && (
              <button
                onClick={handleLoadBenchmark}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-xs font-mono transition-all cursor-pointer"
                title="Populate 200 realistic benchmark trades to evaluate the gate"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Load 200 Benchmark</span>
              </button>
            )}
          </div>
        </div>

        {/* Progress bar towards 200 trades */}
        <div className="mt-3 w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              stats.evaluationGatePassed
                ? 'bg-emerald-500'
                : stats.closedCount >= closedTarget
                ? 'bg-red-500'
                : 'bg-emerald-400'
            }`}
            style={{ width: `${closedProgress}%` }}
          />
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        
        {/* KPI 1: Open Positions */}
        <div className="bg-[#111827] border border-[#1F2937] p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium mb-1">
            <span>Open Positions</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{stats.openCount}</span>
            <span className="text-xs font-mono text-zinc-500">/ {config.maxOpen} MAX_OPEN</span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-400 flex items-center justify-between">
            <span>Slots free: {config.maxOpen - stats.openCount}</span>
            <button
              onClick={() => onNavigateToTab('positions')}
              className="text-emerald-400 hover:underline flex items-center text-[10px]"
            >
              View <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* KPI 2: Win Rate */}
        <div className="bg-[#111827] border border-[#1F2937] p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium mb-1">
            <span>Paper Win Rate</span>
            <Percent className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">
              {stats.winRatePct.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-zinc-400">
              ({stats.winCount}W / {stats.lossCount}L)
            </span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-400">
            Total closed: {stats.closedCount} trades
          </div>
        </div>

        {/* KPI 3: Mean & Median PnL (1x vs 2x Slippage) */}
        <div className="bg-[#111827] border border-[#1F2937] p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium mb-1">
            <span>Mean & Median PnL</span>
            <Activity className="w-4 h-4 text-purple-400" />
          </div>
          <div className="space-y-0.5 font-mono">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">1x Slip:</span>
              <span className={`font-bold ${stats.meanPnl1x >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.meanPnl1x >= 0 ? '+' : ''}{stats.meanPnl1x.toFixed(2)}% (med {stats.medianPnl1x >= 0 ? '+' : ''}{stats.medianPnl1x.toFixed(2)}%)
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">2x Slip:</span>
              <span className={`font-bold ${stats.meanPnl2x >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.meanPnl2x >= 0 ? '+' : ''}{stats.meanPnl2x.toFixed(2)}% (med {stats.medianPnl2x >= 0 ? '+' : ''}{stats.medianPnl2x.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="mt-1.5 text-[10px] text-zinc-500">
            Includes -8% exit slip & 2x stress test
          </div>
        </div>

        {/* KPI 4: Equity & Max Drawdown */}
        <div className="bg-[#111827] border border-[#1F2937] p-3.5 rounded-xl">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium mb-1">
            <span>Max Drawdown</span>
            <TrendingDown className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {stats.maxDrawdownPct1x.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-zinc-400">
              (2x: {stats.maxDrawdownPct2x.toFixed(1)}%)
            </span>
          </div>
          <div className="mt-2 text-[11px] text-zinc-400 font-mono">
            Equity Index: {stats.currentEquity1x.toFixed(1)} pts
          </div>
        </div>

      </div>

      {/* Live Engine Status & Active Positions Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        
        {/* Left 2 Cols: Open Positions Quick Table */}
        <div className="lg:col-span-2 bg-[#111827] border border-[#1F2937] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">Active Paper Positions</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                {openPositions.length} / {config.maxOpen}
              </span>
            </div>
            <button
              onClick={() => onNavigateToTab('positions')}
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-mono"
            >
              Full View <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {openPositions.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-xs font-mono">
              <Layers className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
              <span>No open paper positions. Scanner is listening for signals.</span>
              <div className="mt-2 text-zinc-600 text-[11px]">
                {isScannerActive ? 'Live Polling active (every 3s)' : 'Scanner stopped. Click START SCAN above.'}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {openPositions.map(pos => {
                const isProfitable = pos.unrealizedPnlPct >= 0;
                const holdSec = Math.round((Date.now() - pos.openedAt) / 1000);

                return (
                  <div
                    key={pos.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 gap-2 font-mono text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{pos.symbol}</span>
                          <span className="text-zinc-500 text-[11px]">
                            {pos.mint.slice(0, 4)}...{pos.mint.slice(-4)}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          Entry: ${pos.entryPrice.toFixed(6)} • Liq: ${Math.round(pos.currentLiqUsd).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 justify-between sm:justify-end">
                      {pos.tookHalf && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-500/30">
                          50% TP
                        </span>
                      )}
                      {pos.trailingArmed && (
                        <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">
                          TRAIL ARMED
                        </span>
                      )}
                      {pos.isUnresolved && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
                          UNRESOLVED
                        </span>
                      )}

                      <div className="text-right">
                        <div className={`font-bold text-sm ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isProfitable ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          Hold: {holdSec}s (peak +{pos.peakPnlPct.toFixed(1)}%)
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Col: Recent Signal Gate Activity */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-sm text-white">Recent Gate Verdicts</span>
            <button
              onClick={() => onNavigateToTab('signals')}
              className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-mono"
            >
              Feed <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {signalLogs.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-xs font-mono">
              <span>No signals received yet.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {signalLogs.map(log => {
                const passed = log.status === 'entered';
                return (
                  <div
                    key={log.id}
                    className="p-2 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-300 font-semibold truncate max-w-[140px]">
                        {log.mint.slice(0, 6)}...{log.mint.slice(-4)}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          passed
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {log.status.toUpperCase()}
                      </span>
                    </div>
                    {log.rejectionReasons && log.rejectionReasons.length > 0 && (
                      <div className="text-[10px] text-red-400/90 truncate">
                        {log.rejectionReasons[0]}
                      </div>
                    )}
                    {log.skipReason && (
                      <div className="text-[10px] text-zinc-500">
                        Skip: {log.skipReason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
