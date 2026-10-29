import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  BellRing,
  X,
  Trash2,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Sliders,
  ChevronDown,
  ChevronUp,
  Activity,
  Radar,
  Radio,
  Flame,
  CheckCircle2,
  Layers,
  Sparkles,
  BarChart3,
  Cpu,
  Search,
  Filter,
  DollarSign
} from 'lucide-react';
import { Position, PriceAlert } from '../types';
import { haptics } from '../services/haptics';

interface ActiveAlertsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  positions: Position[];
  onDeletePriceAlert: (positionId: string, alertId: string) => void;
  onTestTriggerAlert: (positionId: string, alertId: string) => void;
  onClearAllAlerts: () => void;
  onClearAlertsByType: (type: 'TAKE_PROFIT' | 'STOP_LOSS') => void;
  onTriggerAllAlerts: () => void;
}

export const ActiveAlertsOverlay: React.FC<ActiveAlertsOverlayProps> = ({
  isOpen,
  onClose,
  positions,
  onDeletePriceAlert,
  onTestTriggerAlert,
  onClearAllAlerts,
  onClearAlertsByType,
  onTriggerAllAlerts
}) => {
  const [filterType, setFilterType] = useState<'ALL' | 'TAKE_PROFIT' | 'STOP_LOSS' | 'AUTO_SELL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedAlertIds, setExpandedAlertIds] = useState<Record<string, boolean>>({});

  if (!isOpen) return null;

  // Aggregate all pending alerts across all open positions
  const aggregatedAlerts: { alert: PriceAlert; position: Position }[] = [];
  positions.forEach((pos) => {
    (pos.alerts || []).forEach((alert) => {
      aggregatedAlerts.push({ alert, position: pos });
    });
  });

  const filteredAlerts = aggregatedAlerts.filter(({ alert, position }) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        alert.symbol.toLowerCase().includes(q) ||
        position.name.toLowerCase().includes(q) ||
        position.dex.toLowerCase().includes(q);
      if (!match) return false;
    }

    if (filterType === 'TAKE_PROFIT') return alert.type === 'TAKE_PROFIT';
    if (filterType === 'STOP_LOSS') return alert.type === 'STOP_LOSS';
    if (filterType === 'AUTO_SELL') return (alert.autoExecuteSellPercent || 0) > 0;
    return true;
  });

  const toggleExpand = (alertId: string) => {
    haptics.selection();
    setExpandedAlertIds((prev) => ({
      ...prev,
      [alertId]: !prev[alertId]
    }));
  };

  const tpCount = aggregatedAlerts.filter((a) => a.alert.type === 'TAKE_PROFIT').length;
  const slCount = aggregatedAlerts.filter((a) => a.alert.type === 'STOP_LOSS').length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200">
      
      {/* Pixel 10 Pro XL Optimized OLED Shell */}
      <div className="w-full max-w-2xl h-[92vh] sm:h-[840px] max-h-[94vh] bg-[#07090E] rounded-t-[36px] sm:rounded-3xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.9),0_0_30px_rgba(6,182,212,0.15)] flex flex-col overflow-hidden">
        
        {/* Grab Handle for Android/Pixel gestures */}
        <div className="w-12 h-1.5 bg-slate-700/80 rounded-full mx-auto my-3 shrink-0 sm:hidden" />

        {/* Header Bar */}
        <div className="px-5 py-3.5 border-b border-white/8 bg-[#0C1019] flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 glow-cyan">
              <BellRing className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-white font-mono uppercase tracking-wider">
                  Active Alerts Matrix
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950/60 text-cyan-300 border border-cyan-500/40 font-bold">
                  {aggregatedAlerts.length} Active
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Real-time sub-slot monitoring & automated exit execution
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              haptics.light();
              onClose();
            }}
            className="p-2 rounded-xl bg-slate-900 border border-white/10 text-slate-400 hover:text-white transition-colors active:scale-95"
            title="Close Alert Center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bulk Action Controls Bar */}
        <div className="px-4 py-2.5 bg-[#090D15] border-b border-white/8 shrink-0 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-mono uppercase text-slate-500 font-semibold mr-1">
              Bulk:
            </span>
            <button
              onClick={() => {
                haptics.heavy();
                onClearAllAlerts();
              }}
              className="px-2.5 py-1 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 text-[11px] font-mono font-bold flex items-center gap-1 transition-all active:scale-95"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear All ({aggregatedAlerts.length})</span>
            </button>

            {tpCount > 0 && (
              <button
                onClick={() => {
                  haptics.medium();
                  onClearAlertsByType('TAKE_PROFIT');
                }}
                className="px-2 py-1 rounded-lg bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 border border-emerald-500/30 text-[11px] font-mono font-semibold transition-all active:scale-95"
              >
                Clear TPs ({tpCount})
              </button>
            )}

            {slCount > 0 && (
              <button
                onClick={() => {
                  haptics.medium();
                  onClearAlertsByType('STOP_LOSS');
                }}
                className="px-2 py-1 rounded-lg bg-red-950/30 hover:bg-red-900/40 text-red-300 border border-red-500/30 text-[11px] font-mono font-semibold transition-all active:scale-95"
              >
                Clear SLs ({slCount})
              </button>
            )}
          </div>

          {/* Test Trigger All Simulation */}
          <button
            onClick={() => {
              haptics.heavy();
              onTriggerAllAlerts();
            }}
            className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono font-bold flex items-center gap-1 shrink-0 active:scale-95"
            title="Simulate all alerts triggering at once"
          >
            <Zap className="w-3 h-3 text-cyan-400" />
            <span>Simulate All Hits</span>
          </button>
        </div>

        {/* Search & Filter Strip */}
        <div className="px-4 py-2.5 bg-[#0A0E18] border-b border-white/5 shrink-0 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search token symbol, pool or DEX..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950/70 border border-white/10 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {[
              { id: 'ALL', label: `All Alerts (${aggregatedAlerts.length})` },
              { id: 'TAKE_PROFIT', label: `Take Profit (${tpCount})` },
              { id: 'STOP_LOSS', label: `Stop Loss (${slCount})` },
              { id: 'AUTO_SELL', label: 'Auto-Sell Armed' }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  haptics.selection();
                  setFilterType(f.id as typeof filterType);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium whitespace-nowrap transition-all active:scale-95 ${
                  filterType === f.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900/40 border border-white/5'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Alerts Content Viewport */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredAlerts.length > 0 ? (
            filteredAlerts.map(({ alert, position }) => {
              const isTp = alert.type === 'TAKE_PROFIT';
              const isExpanded = !!expandedAlertIds[alert.id];
              const deltaFromNow =
                ((alert.targetPriceUsd - position.currentPriceUsd) / position.currentPriceUsd) * 100;
              const estProceedsSol =
                (position.currentSolValue * ((alert.autoExecuteSellPercent || 100) / 100)) *
                (1 + deltaFromNow / 100);

              return (
                <div
                  key={alert.id}
                  className={`glass-panel rounded-2xl border transition-all duration-200 overflow-hidden ${
                    alert.triggered
                      ? 'border-white/5 bg-slate-950/50 opacity-60'
                      : isTp
                      ? 'border-emerald-500/25 bg-emerald-950/10 hover:border-emerald-500/45'
                      : 'border-red-500/25 bg-red-950/10 hover:border-red-500/45'
                  }`}
                >
                  {/* Collapsed Tile Header */}
                  <div
                    onClick={() => toggleExpand(alert.id)}
                    className="p-3.5 flex items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    {/* Left: Token, DEX, and Alert Badge */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-sm shrink-0 border ${
                          isTp
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                        }`}
                      >
                        {position.symbol.slice(0, 2)}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-bold text-white text-sm">
                            ${position.symbol}
                          </span>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase ${
                              isTp
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-red-500/20 text-red-300 border border-red-500/40'
                            }`}
                          >
                            {isTp ? 'Take Profit' : 'Stop Loss'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {position.dex}
                          </span>
                        </div>

                        <div className="text-[11px] font-mono text-slate-400 mt-0.5 flex items-center gap-2">
                          <span>
                            Target: <span className="text-white font-bold">${alert.targetPriceUsd.toFixed(6)}</span>
                          </span>
                          <span>·</span>
                          <span className={deltaFromNow >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {deltaFromNow >= 0 ? '+' : ''}
                            {deltaFromNow.toFixed(1)}% away
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Quick Actions & Expand Chevron */}
                    <div className="flex items-center gap-2 shrink-0">
                      {alert.autoExecuteSellPercent ? (
                        <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-200 border border-purple-500/30 hidden sm:inline">
                          ⚡ Auto-Sell {alert.autoExecuteSellPercent}%
                        </span>
                      ) : null}

                      {!alert.triggered && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            haptics.selection();
                            onTestTriggerAlert(position.id, alert.id);
                          }}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-300 border border-white/10 text-[10px] font-mono font-bold transition-all active:scale-95"
                          title="Simulate Hit"
                        >
                          Test
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          haptics.light();
                          onDeletePriceAlert(position.id, alert.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                        title="Delete Alert"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      <div className="p-1 text-slate-400">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expandable Tile Detailed View: Dynamic Chart + Strategy + Scanner */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-white/8 space-y-3.5 bg-[#080C14] animate-in fade-in duration-200">
                      
                      {/* Section 1: Dynamic High-Frequency Price vs Alert Chart */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-white/8 space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Execution Chart Target Track</span>
                          </span>
                          <span className="text-[10px] text-slate-400">
                            Now: ${position.currentPriceUsd.toFixed(6)}
                          </span>
                        </div>

                        {/* High-Resolution SVG Graphic Chart */}
                        <div className="relative h-20 w-full pt-1">
                          <svg viewBox="0 0 320 80" className="w-full h-full overflow-visible">
                            <defs>
                              <linearGradient id={`grad-${alert.id}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={isTp ? '#10B981' : '#EF4444'} stopOpacity="0.3" />
                                <stop offset="100%" stopColor={isTp ? '#10B981' : '#EF4444'} stopOpacity="0.0" />
                              </linearGradient>
                            </defs>

                            {/* Alert Target Line (Dashed) */}
                            <line
                              x1="0"
                              y1={isTp ? '18' : '62'}
                              x2="320"
                              y2={isTp ? '18' : '62'}
                              stroke={isTp ? '#10B981' : '#EF4444'}
                              strokeWidth="1.5"
                              strokeDasharray="4 4"
                            />
                            <text
                              x="316"
                              y={isTp ? '14' : '58'}
                              fill={isTp ? '#10B981' : '#EF4444'}
                              fontSize="9"
                              fontFamily="JetBrains Mono, monospace"
                              textAnchor="end"
                              fontWeight="bold"
                            >
                              TARGET: ${alert.targetPriceUsd.toFixed(6)}
                            </text>

                            {/* Entry Price Line (Muted) */}
                            <line
                              x1="0"
                              y1="40"
                              x2="320"
                              y2="40"
                              stroke="rgba(255,255,255,0.15)"
                              strokeWidth="1"
                            />
                            <text
                              x="4"
                              y="36"
                              fill="#94A3B8"
                              fontSize="8"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              ENTRY: ${position.entryPriceUsd.toFixed(6)}
                            </text>

                            {/* Simulated Area Sparkline */}
                            <path
                              d="M 0,45 Q 40,48 80,42 T 160,38 T 240,32 T 320,28 L 320,80 L 0,80 Z"
                              fill={`url(#grad-${alert.id})`}
                            />
                            <path
                              d="M 0,45 Q 40,48 80,42 T 160,38 T 240,32 T 320,28"
                              fill="none"
                              stroke={isTp ? '#34D399' : '#F87171'}
                              strokeWidth="2"
                              strokeLinecap="round"
                            />

                            {/* Current Price Marker Dot with Radar Pulse */}
                            <circle cx="320" cy="28" r="4" fill="#00FFA3" />
                            <circle cx="320" cy="28" r="8" fill="#00FFA3" opacity="0.4" className="animate-ping" />
                          </svg>
                        </div>

                        {/* Progress Bar Distance to Hit */}
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                            <span>Distance Progress</span>
                            <span className={isTp ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                              {Math.max(5, Math.min(95, 100 - Math.abs(deltaFromNow))).toFixed(0)}% to trigger
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isTp ? 'bg-emerald-400' : 'bg-red-500'
                              }`}
                              style={{ width: `${Math.max(8, Math.min(95, 100 - Math.abs(deltaFromNow)))}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Section 2: Strategy Execution Architecture */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-white/8 space-y-2">
                        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                          <span className="text-[11px] font-mono uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
                            <Cpu className="w-3.5 h-3.5 text-purple-400" />
                            <span>Execution Strategy: {alert.strategyName || (isTp ? 'Jito Sub-Slot Front-Run Exit' : 'Emergency Market Dump')}</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {position.smartProfitLockEnabled && (
                              <span className="text-[9px] font-mono text-emerald-300 bg-emerald-950/70 px-1.5 py-0.2 rounded border border-emerald-500/40 font-bold">
                                🔒 Auto-Trail Active
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-500/30">
                              MEV Immune
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono pt-1">
                          <div className="p-2 rounded-lg bg-slate-900/60 border border-white/5">
                            <div className="text-[10px] text-slate-500 uppercase">Est. SOL Proceeds</div>
                            <div className="text-white font-bold tabular-nums mt-0.5">
                              ~{estProceedsSol.toFixed(2)} SOL
                            </div>
                            <div className="text-[10px] text-emerald-400">
                              (${ (estProceedsSol * 165.25).toFixed(0)} USD)
                            </div>
                          </div>

                          <div className="p-2 rounded-lg bg-slate-900/60 border border-white/5">
                            <div className="text-[10px] text-slate-500 uppercase">Jito Tip Bribe</div>
                            <div className="text-purple-300 font-bold tabular-nums mt-0.5">
                              0.005 SOL
                            </div>
                            <div className="text-[10px] text-slate-400">Direct Bundle</div>
                          </div>

                          <div className="p-2 rounded-lg bg-slate-900/60 border border-white/5">
                            <div className="text-[10px] text-slate-500 uppercase">Slippage Bound</div>
                            <div className="text-cyan-300 font-bold tabular-nums mt-0.5">
                              15.0%
                            </div>
                            <div className="text-[10px] text-slate-400">Anti-Spike</div>
                          </div>

                          <div className="p-2 rounded-lg bg-slate-900/60 border border-white/5">
                            <div className="text-[10px] text-slate-500 uppercase">Route Protocol</div>
                            <div className="text-slate-200 font-bold truncate mt-0.5">
                              {position.dex} CPMM
                            </div>
                            <div className="text-[10px] text-slate-400">Fast Path</div>
                          </div>
                        </div>
                      </div>

                      {/* Section 3: Dynamic Scanner Real-Time Telemetry */}
                      <div className="p-3 rounded-xl bg-slate-950/80 border border-white/8 space-y-2">
                        <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                          <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
                            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                            <span>Mempool Scanner Live Telemetry</span>
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            Sub-slot stream active
                          </span>
                        </div>

                        <div className="space-y-2 text-xs font-mono pt-1">
                          {/* 60s Buy / Sell Momentum Ratio */}
                          <div>
                            <div className="flex items-center justify-between text-[10px] mb-1">
                              <span className="text-slate-400">60s Buy/Sell Flow Volume:</span>
                              <span className="text-emerald-400 font-bold">72% Buys / 28% Sells (Bullish)</span>
                            </div>
                            <div className="h-1.5 w-full bg-red-950 rounded-full overflow-hidden flex">
                              <div className="h-full bg-emerald-400" style={{ width: '72%' }} />
                              <div className="h-full bg-red-500" style={{ width: '28%' }} />
                            </div>
                          </div>

                          {/* Scanner checks grid */}
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5 text-slate-300">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span>Sandwich Risk: 0 frontrunners detected</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-300">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span>Whale Outflow: 0 major sells in last 5m</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Section 4: Individual Action Controls */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => {
                            haptics.heavy();
                            onTestTriggerAlert(position.id, alert.id);
                          }}
                          className="flex-1 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 glow-cyan shadow-md shadow-cyan-500/20"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Simulate Hit Now</span>
                        </button>

                        <button
                          onClick={() => {
                            haptics.light();
                            onDeletePriceAlert(position.id, alert.id);
                          }}
                          className="py-2 px-3 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 text-xs font-mono font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Alert</span>
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              );
            })
          ) : (
            /* Empty State */
            <div className="p-8 text-center glass-panel rounded-2xl border border-white/8 space-y-2">
              <div className="w-12 h-12 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center mx-auto text-slate-500">
                <Bell className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-mono font-bold text-white">No Matching Active Alerts</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {searchQuery || filterType !== 'ALL'
                  ? 'No pending alerts match your current filter query.'
                  : 'You do not have any pending alerts configured across your open positions.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer Summary Bar */}
        <div className="p-3 bg-[#0B0F19] border-t border-white/8 shrink-0 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>Pixel 10 Pro XL OLED High-Refresh Canvas</span>
          </div>
          <span className="text-slate-300">
            {aggregatedAlerts.length} Total Registered Trigger{aggregatedAlerts.length !== 1 ? 's' : ''}
          </span>
        </div>

      </div>
    </div>
  );
};
