import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Shield,
  Percent,
  Sliders,
  Flame,
  CheckCircle2,
  DollarSign,
  Clock,
  Sparkles,
  Bell,
  BellRing,
  Plus,
  Trash2,
  AlertTriangle,
  Zap,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Target,
  Layers,
  Radio,
  Cpu,
  BarChart3,
  Maximize2,
  Minimize2,
  RefreshCw,
  Activity,
  Minus,
  Lock,
  Unlock,
  Check
} from 'lucide-react';
import { Position, PriceAlert, TakeProfitTier } from '../types';
import { haptics } from '../services/haptics';
import { ActiveAlertsOverlay } from './ActiveAlertsOverlay';
import { PositionD3Chart } from './PositionD3Chart';

interface PositionsHUDProps {
  positions: Position[];
  onSellPosition: (positionId: string, portionPercent: number) => void;
  onUpdateTrailingStop: (positionId: string, newPercent: number) => void;
  onAddPriceAlert: (
    positionId: string,
    alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered' | 'positionId' | 'symbol'>
  ) => void;
  onDeletePriceAlert: (positionId: string, alertId: string) => void;
  onTestTriggerAlert: (positionId: string, alertId: string) => void;
  onClearAllAlerts: () => void;
  onClearAlertsByType: (type: 'TAKE_PROFIT' | 'STOP_LOSS') => void;
  onTriggerAllAlerts: () => void;
  onUpdatePositionStrategy?: (positionId: string, updates: Partial<Position>) => void;
  onSimulateProfitLockTier?: (positionId: string, tierNumber: number) => void;
}

export const PositionsHUD: React.FC<PositionsHUDProps> = ({
  positions,
  onSellPosition,
  onUpdateTrailingStop,
  onAddPriceAlert,
  onDeletePriceAlert,
  onTestTriggerAlert,
  onClearAllAlerts,
  onClearAlertsByType,
  onTriggerAllAlerts,
  onUpdatePositionStrategy,
  onSimulateProfitLockTier
}) => {
  const [editingStopPosition, setEditingStopPosition] = useState<Position | null>(null);
  const [tempTrailingPercent, setTempTrailingPercent] = useState<number>(15);

  // Active Alerts Matrix Overlay Modal State
  const [isAlertsOverlayOpen, setIsAlertsOverlayOpen] = useState(false);

  // Global toggle to show/hide pending alerts across all cards
  const [showPendingAlerts, setShowPendingAlerts] = useState<boolean>(true);
  
  // Per-position card accordion toggle state
  const [expandedAlertCards, setExpandedAlertCards] = useState<Record<string, boolean>>({});

  // Click-to-expand position card nested dashboard state (defaults first position open)
  const [expandedPositionIds, setExpandedPositionIds] = useState<Record<string, boolean>>({
    'pos-1': true
  });

  const toggleExpandPosition = (posId: string) => {
    haptics.selection();
    setExpandedPositionIds((prev) => ({
      ...prev,
      [posId]: !prev[posId]
    }));
  };

  // Price Alert Modal State
  const [alertPosition, setAlertPosition] = useState<Position | null>(null);
  const [alertType, setAlertType] = useState<'TAKE_PROFIT' | 'STOP_LOSS'>('TAKE_PROFIT');
  const [alertTargetPrice, setAlertTargetPrice] = useState<string>('');
  const [alertAutoSell, setAlertAutoSell] = useState<number>(0); // 0 = notification only, 50, 100

  const toggleCardAlerts = (posId: string) => {
    haptics.selection();
    setExpandedAlertCards((prev) => ({
      ...prev,
      [posId]: prev[posId] !== undefined ? !prev[posId] : false
    }));
  };

  const solPriceUsd = 165.25;

  const totalPnlSol = positions.reduce((acc, p) => acc + p.pnlSol, 0);
  const totalPnlUsd = totalPnlSol * solPriceUsd;
  const totalInvestedSol = positions.reduce((acc, p) => acc + p.initialSolInvested, 0);
  const totalCurrentValueSol = positions.reduce((acc, p) => acc + p.currentSolValue, 0);

  const isNetProfit = totalPnlSol >= 0;

  // Open Alert Modal Helper
  const handleOpenAlertModal = (pos: Position, defaultType: 'TAKE_PROFIT' | 'STOP_LOSS' = 'TAKE_PROFIT') => {
    setAlertPosition(pos);
    setAlertType(defaultType);
    const defaultTarget =
      defaultType === 'TAKE_PROFIT'
        ? (pos.currentPriceUsd * 1.5).toFixed(6)
        : (pos.currentPriceUsd * 0.85).toFixed(6);
    setAlertTargetPrice(defaultTarget);
    setAlertAutoSell(0);
    haptics.selection();
  };

  const handleApplyPresetDelta = (deltaPercent: number) => {
    if (!alertPosition) return;
    haptics.selection();
    const newPrice = alertPosition.currentPriceUsd * (1 + deltaPercent / 100);
    setAlertTargetPrice(newPrice.toFixed(6));
  };

  const handleSimulateTier = (targetPos: Position, tier: TakeProfitTier) => {
    haptics.success();
    if (onSimulateProfitLockTier) {
      onSimulateProfitLockTier(targetPos.id, tier.tier);
      return;
    }

    const floorPct = tier.lockFloorPercent ?? (tier.tier === 1 ? 2 : tier.tier === 2 ? 35 : 80);
    const trailPct = tier.tightenedTrailingPercent ?? (tier.tier === 1 ? 10 : tier.tier === 2 ? 6 : 3.5);
    const targetPrice = targetPos.entryPriceUsd * (1 + tier.targetPercent / 100);
    const newHighest = Math.max(targetPos.highestPriceUsd, targetPrice);
    const newStopPrice = Math.max(
      newHighest * (1 - trailPct / 100),
      targetPos.entryPriceUsd * (1 + floorPct / 100)
    );
    const updatedTiers = targetPos.takeProfitTiers.map((t) =>
      t.tier <= tier.tier ? { ...t, hit: true } : t
    );

    onUpdatePositionStrategy?.(targetPos.id, {
      smartProfitLockEnabled: true,
      smartProfitLockStage: tier.tier,
      smartProfitFloorPercent: floorPct,
      trailingStopPercent: trailPct,
      highestPriceUsd: newHighest,
      stopPriceUsd: newStopPrice,
      takeProfitTiers: updatedTiers
    });
  };

  const handleSaveAlert = () => {
    if (!alertPosition) return;
    const priceNum = parseFloat(alertTargetPrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    const deltaPercentFromCurrent =
      ((priceNum - alertPosition.currentPriceUsd) / alertPosition.currentPriceUsd) * 100;

    haptics.success();
    onAddPriceAlert(alertPosition.id, {
      type: alertType,
      targetPriceUsd: priceNum,
      deltaPercentFromCurrent,
      autoExecuteSellPercent: alertAutoSell > 0 ? alertAutoSell : undefined
    });

    setAlertPosition(null);
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Prominent Net Paper Profit Counter Banner */}
      <div className="glass-panel-elevated rounded-2xl p-5 border border-white/10 relative overflow-hidden">
        {/* Glow background */}
        <div
          className={`absolute -right-12 -top-12 w-44 h-44 rounded-full blur-3xl opacity-20 pointer-events-none ${
            isNetProfit ? 'bg-emerald-500' : 'bg-red-500'
          }`}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span>Net Paper PnL (Unrealized)</span>
            </span>
            <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Ticker
            </span>
          </div>

          {/* Rolling Big Value */}
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight tabular-nums ${
                isNetProfit ? 'text-emerald-400 glow-emerald' : 'text-red-400 glow-crimson'
              }`}
            >
              {isNetProfit ? '+' : ''}
              {totalPnlSol.toFixed(2)} SOL
            </span>
            <span className="text-sm sm:text-base font-mono text-slate-300 tabular-nums">
              ({isNetProfit ? '+' : ''}${Math.abs(totalPnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
            </span>
          </div>

          {/* Sub Stats Row */}
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/8 text-xs font-mono">
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Invested</div>
              <div className="text-slate-200 font-bold tabular-nums mt-0.5">
                {totalInvestedSol.toFixed(2)} SOL
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Current Value</div>
              <div className="text-emerald-300 font-bold tabular-nums mt-0.5">
                {totalCurrentValueSol.toFixed(2)} SOL
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-500 uppercase">Win Rate</div>
              <div className="text-white font-bold tabular-nums mt-0.5">85.7% (6/7)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Notification Banner if displaying sample/demo positions */}
      {positions.some((p) => p.isDemo) && (
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-mono flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-base">⚠️</span>
            <span>Demo Mode: Displaying simulated positions for HUD inspection. Real paper trades open automatically from live signals.</span>
          </div>
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-950/60 border border-amber-500/40 text-amber-200 shrink-0">
            DEMO PREVIEW
          </span>
        </div>
      )}

      {/* Active Positions List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold">
              Active Open Positions ({positions.length})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Open Active Alerts Matrix Overlay Button */}
            <button
              onClick={() => {
                haptics.heavy();
                setIsAlertsOverlayOpen(true);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 glow-cyan transition-all active:scale-95 shadow-sm"
              title="Open Aggregated Active Alerts Matrix Overlay"
            >
              <BellRing className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span>
                Alerts Matrix ({positions.reduce((acc, p) => acc + (p.alerts ? p.alerts.filter((a) => !a.triggered).length : 0), 0)})
              </span>
            </button>

            {/* Show/Hide Pending Alerts Global Toggle */}
            <button
              onClick={() => {
                haptics.selection();
                setShowPendingAlerts(!showPendingAlerts);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all active:scale-95 border ${
                showPendingAlerts
                  ? 'bg-slate-900 text-slate-300 border-white/10 shadow-sm'
                  : 'bg-slate-900/60 text-slate-400 border-white/8 hover:text-slate-200'
              }`}
              title="Toggle show/hide pending price alerts"
            >
              {showPendingAlerts ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline">Hide Pending</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                  <span className="hidden sm:inline">Show Pending</span>
                </>
              )}
            </button>
          </div>
        </div>

        {positions.map((pos) => {
          const isProfitable = pos.pnlPercent >= 0;
          const stopDistancePercent = ((pos.currentPriceUsd - pos.stopPriceUsd) / pos.currentPriceUsd) * 100;
          const activeAlerts = pos.alerts || [];
          const isCardAlertsExpanded = showPendingAlerts && (expandedAlertCards[pos.id] ?? true);
          const isPositionExpanded = !!expandedPositionIds[pos.id];

          return (
            <motion.div
              layout
              key={pos.id}
              className={`glass-panel rounded-2xl p-4 border transition-all duration-200 space-y-3.5 ${
                isPositionExpanded
                  ? 'border-cyan-500/35 bg-[#090C16]/95 shadow-[0_0_30px_rgba(6,182,212,0.12)]'
                  : 'border-white/8 hover:border-emerald-500/30'
              }`}
            >
              {/* Position Header (Click-to-Expand Trigger) */}
              <div
                onClick={() => toggleExpandPosition(pos.id)}
                className="flex items-start justify-between gap-3 cursor-pointer select-none"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center font-mono font-bold text-sm text-emerald-400 shadow-inner shrink-0">
                    {pos.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white font-mono">
                        ${pos.symbol}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {pos.dex}
                      </span>
                      {pos.isDemo && (
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          DEMO
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 font-mono">· {pos.timestamp}</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-200 font-sans truncate max-w-[190px]">
                      {pos.name || pos.symbol}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {pos.tokensAmount.toLocaleString()} tokens · ${pos.currentPriceUsd.toFixed(6)}
                    </div>
                  </div>
                </div>

                {/* Individual PnL & Expand Badge */}
                <div className="flex flex-col items-end gap-1">
                  <div className="text-right">
                    <div
                      className={`text-sm font-bold font-mono tabular-nums leading-tight ${
                        isProfitable ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {isProfitable ? '+' : ''}
                      {pos.pnlSol.toFixed(2)} SOL
                    </div>
                    <div
                      className={`text-xs font-mono tabular-nums ${
                        isProfitable ? 'text-emerald-500' : 'text-red-500'
                      }`}
                    >
                      {isProfitable ? '+' : ''}
                      {pos.pnlPercent.toFixed(1)}%
                    </div>
                  </div>

                  {/* Expand Dashboard Toggle Chip */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpandPosition(pos.id);
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold transition-all active:scale-95 border ${
                      isPositionExpanded
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 glow-cyan'
                        : 'bg-slate-900 text-slate-400 border-white/10 hover:text-white'
                    }`}
                    title={isPositionExpanded ? 'Collapse nested dashboard' : 'Expand D3 chart, strategy & scanner'}
                  >
                    {isPositionExpanded ? (
                      <>
                        <Minimize2 className="w-3 h-3 text-cyan-400" />
                        <span>Dashboard</span>
                        <ChevronUp className="w-3 h-3 text-cyan-400" />
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3 h-3 text-slate-400" />
                        <span>D3 Chart</span>
                        <ChevronDown className="w-3 h-3 text-slate-400" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Direct Badges: Smart Profit Lock Quick Badge & Price Alert Badges */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                {/* Smart Profit Lock Quick Badge */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    haptics.selection();
                    const nextVal = !(pos.smartProfitLockEnabled ?? true);
                    onUpdatePositionStrategy?.(pos.id, { smartProfitLockEnabled: nextVal });
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-all active:scale-95 cursor-pointer ${
                    pos.smartProfitLockEnabled
                      ? pos.stopPriceUsd >= pos.entryPriceUsd
                        ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                        : 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-900/60 text-slate-500 border-white/5 hover:text-slate-300'
                  }`}
                  title="Click to toggle Smart Profit Lock auto-trail"
                >
                  {pos.smartProfitLockEnabled ? (
                    <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Unlock className="w-3 h-3 text-slate-500 shrink-0" />
                  )}
                  <span>
                    {pos.smartProfitLockEnabled
                      ? pos.stopPriceUsd >= pos.entryPriceUsd
                        ? `LOCK: +${(((pos.stopPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(0)}% MIN`
                        : 'AUTO-TRAIL ARMED'
                      : 'PROFIT LOCK OFF'}
                  </span>
                </button>

                {activeAlerts.length > 0 && activeAlerts.map((alert) => {
                  const isTp = alert.type === 'TAKE_PROFIT';
                  const deltaFromNow =
                    ((alert.targetPriceUsd - pos.currentPriceUsd) / pos.currentPriceUsd) * 100;

                  return (
                    <button
                      key={alert.id}
                      onClick={() => handleOpenAlertModal(pos, alert.type)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-all active:scale-95 ${
                        alert.triggered
                          ? 'bg-slate-900/60 text-slate-500 border-white/5 line-through opacity-70'
                          : isTp
                          ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40 hover:bg-emerald-900/40 shadow-sm shadow-emerald-500/10'
                          : 'bg-red-950/40 text-red-300 border-red-500/40 hover:bg-red-900/40 shadow-sm shadow-red-500/10'
                      }`}
                      title={`Click to edit ${isTp ? 'Take Profit' : 'Stop Loss'} Alert: $${alert.targetPriceUsd.toFixed(6)}`}
                    >
                      {isTp ? (
                        <ArrowUpRight className="w-3 h-3 text-emerald-400 shrink-0" />
                      ) : (
                        <ArrowDownRight className="w-3 h-3 text-red-400 shrink-0" />
                      )}
                      <span>{isTp ? 'TP' : 'SL'}</span>
                      <span className="tabular-nums">
                        ${alert.targetPriceUsd < 0.01 ? alert.targetPriceUsd.toFixed(5) : alert.targetPriceUsd.toFixed(4)}
                      </span>
                      <span className={`text-[9px] ${isTp ? 'text-emerald-400' : 'text-red-400'}`}>
                        ({deltaFromNow >= 0 ? '+' : ''}{deltaFromNow.toFixed(1)}%)
                      </span>
                      {alert.autoExecuteSellPercent ? (
                        <span className="text-[8px] px-1 py-0.2 rounded bg-purple-900/60 text-purple-200">
                          ⚡{alert.autoExecuteSellPercent}%
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Trailing Stop Progress Track Visualizer */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400 flex items-center gap-1">
                    {pos.smartProfitLockEnabled && pos.stopPriceUsd >= pos.entryPriceUsd ? (
                      <span className="flex items-center gap-1 text-emerald-400 font-bold">
                        <Lock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Profit Floor (+{(((pos.stopPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%)</span>
                      </span>
                    ) : (
                      <>
                        <Shield className="w-3.5 h-3.5 text-amber-400" />
                        <span>Trailing Stop: -{pos.trailingStopPercent}%</span>
                      </>
                    )}
                  </span>
                  <span className="text-slate-300">
                    Floor:{' '}
                    <span className={`font-bold ${pos.stopPriceUsd >= pos.entryPriceUsd ? 'text-emerald-400' : 'text-red-400'}`}>
                      ${pos.stopPriceUsd.toFixed(6)}
                    </span>
                  </span>
                </div>

                {/* Progress bar track */}
                <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-red-500/40"
                    style={{ width: `${Math.min(100, Math.max(10, pos.trailingStopPercent * 2))}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(20, (pos.pnlPercent / 200) * 100))}%`
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Entry: ${pos.entryPriceUsd.toFixed(6)}</span>
                  <span className="text-emerald-400 font-semibold">
                    Buffer to Stop: {stopDistancePercent.toFixed(1)}%
                  </span>
                  <span>Peak: ${pos.highestPriceUsd.toFixed(6)}</span>
                </div>
              </div>

              {/* Price Alerts Section on Position (Collapsible via toggle) */}
              <div className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleCardAlerts(pos.id)}
                    className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-slate-300 hover:text-white transition-colors"
                  >
                    <BellRing className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Pending Alerts ({activeAlerts.length})</span>
                    {isCardAlertsExpanded ? (
                      <ChevronUp className="w-3 h-3 text-slate-400 ml-0.5" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
                    )}
                  </button>
                  <button
                    onClick={() => handleOpenAlertModal(pos)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-300 transition-all active:scale-95"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Set Alert</span>
                  </button>
                </div>

                {/* Collapsible Active Alerts Details List */}
                {isCardAlertsExpanded && (
                  activeAlerts.length > 0 ? (
                    <div className="space-y-1.5 pt-1 animate-in fade-in duration-150">
                      {activeAlerts.map((alert) => {
                        const isTp = alert.type === 'TAKE_PROFIT';
                        const deltaFromNow =
                          ((alert.targetPriceUsd - pos.currentPriceUsd) / pos.currentPriceUsd) * 100;

                        return (
                          <div
                            key={alert.id}
                            className={`flex items-center justify-between p-2 rounded-lg text-xs font-mono border transition-all ${
                              alert.triggered
                                ? 'bg-slate-950/40 border-white/5 opacity-60'
                                : isTp
                                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                                : 'bg-red-950/20 border-red-500/30 text-red-300'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                  isTp
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-red-500/20 text-red-300'
                                }`}
                              >
                                {isTp ? 'TP' : 'SL'}
                              </span>
                              <div>
                                <span className="font-bold tabular-nums">
                                  ${alert.targetPriceUsd.toFixed(6)}
                                </span>
                                <span className="text-[10px] text-slate-400 ml-1.5">
                                  ({deltaFromNow >= 0 ? '+' : ''}
                                  {deltaFromNow.toFixed(1)}% away)
                                </span>
                                {alert.autoExecuteSellPercent ? (
                                  <span className="ml-1.5 text-[9px] px-1 py-0.2 rounded bg-purple-900/40 text-purple-300 font-mono">
                                    Auto-Sell {alert.autoExecuteSellPercent}%
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {/* Test Trigger Button */}
                              {!alert.triggered && (
                                <button
                                  onClick={() => {
                                    haptics.selection();
                                    onTestTriggerAlert(pos.id, alert.id);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-cyan-300 border border-white/10 active:scale-95 transition-all"
                                  title="Simulate hitting this alert right now"
                                >
                                  Test
                                </button>
                              )}

                              {alert.triggered ? (
                                <span className="text-[10px] text-slate-400 font-bold uppercase">
                                  Triggered
                                </span>
                              ) : null}

                              {/* Delete Alert Button */}
                              <button
                                onClick={() => {
                                  haptics.light();
                                  onDeletePriceAlert(pos.id, alert.id);
                                }}
                                className="p-1 hover:text-red-400 text-slate-500 transition-colors"
                                title="Delete alert"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 font-mono py-1 flex items-center justify-between">
                      <span>No active price alerts set for ${pos.symbol}</span>
                      <button
                        onClick={() => handleOpenAlertModal(pos)}
                        className="text-cyan-400 hover:underline text-[10px]"
                      >
                        + Add alert
                      </button>
                    </div>
                  )
                )}
              </div>

              {/* Nested Dashboard Section (Click-to-Expand Animation) */}
              <AnimatePresence initial={false}>
                {isPositionExpanded && (
                  <motion.div
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="space-y-3 pt-2 overflow-hidden"
                  >
                    {/* 1. D3-based Real-Time Price Chart */}
                    <div className="p-3 rounded-2xl bg-[#060810]/95 border border-white/10 shadow-lg space-y-2">
                      <PositionD3Chart
                        symbol={pos.symbol}
                        name={pos.name}
                        entryPrice={pos.entryPriceUsd}
                        currentPrice={pos.currentPriceUsd}
                        stopPrice={pos.stopPriceUsd}
                        sparkline={pos.sparkline}
                        isProfitable={isProfitable}
                        smartProfitLockEnabled={pos.smartProfitLockEnabled}
                        lockedProfitPercent={pos.smartProfitFloorPercent}
                      />
                    </div>

                    {/* 2. Secondary 'Execution Strategy' Interactive Control Panel */}
                    <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#0B0E1E]/95 via-[#0D1226]/95 to-[#130E26]/95 border border-purple-500/30 space-y-3 shadow-xl backdrop-blur-md">
                      {/* Panel Header */}
                      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/35">
                            <Cpu className="w-4 h-4 text-purple-400" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold text-white uppercase tracking-wider block leading-tight">
                                Execution Strategy Matrix
                              </span>
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/40 font-semibold">
                                JITO BUNDLE
                              </span>
                            </div>
                            <span className="text-[10px] text-purple-300/80 font-mono">
                              Sub-slot atomic sandwich-immune exit routing
                            </span>
                          </div>
                        </div>

                        {/* Global Strategy Status Indicator */}
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/80 border border-white/10">
                          <div
                            className={`w-1.5 h-1.5 rounded-full ${
                              (pos.autoSellTriggerEnabled ?? true) && (pos.trailingStopActive ?? true)
                                ? 'bg-emerald-400 animate-pulse'
                                : 'bg-amber-400'
                            }`}
                          />
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-300">
                            {(pos.autoSellTriggerEnabled ?? true) && (pos.trailingStopActive ?? true)
                              ? 'ARMED & GUARDED'
                              : 'CUSTOM ACTIVE'}
                          </span>
                        </div>
                      </div>

                      {/* Control 1: Auto-Sell Trigger & Portion */}
                      <div className="p-3 rounded-xl bg-[#070A14]/90 border border-white/8 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <div>
                              <span className="text-xs font-mono font-bold text-white tracking-wide">
                                Auto-Sell Trigger
                              </span>
                              <p className="text-[10px] text-slate-400 font-mono">
                                Fire sub-slot market dump upon TP/SL breach
                              </p>
                            </div>
                          </div>

                          {/* Interactive Toggle */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              haptics.selection();
                              const nextVal = !(pos.autoSellTriggerEnabled ?? true);
                              onUpdatePositionStrategy?.(pos.id, { autoSellTriggerEnabled: nextVal });
                            }}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                              (pos.autoSellTriggerEnabled ?? true)
                                ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                                : 'bg-slate-800'
                            }`}
                            aria-label="Toggle Auto-Sell Trigger"
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                (pos.autoSellTriggerEnabled ?? true) ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>

                        {/* Portion Selector Buttons */}
                        {(pos.autoSellTriggerEnabled ?? true) && (
                          <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                              Trigger Sell Volume:
                            </span>
                            <div className="flex items-center gap-1.5">
                              {[25, 50, 75, 100].map((pct) => {
                                const isSelected = (pos.autoSellPortionPercent ?? 50) === pct;
                                return (
                                  <button
                                    key={pct}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      haptics.selection();
                                      onUpdatePositionStrategy?.(pos.id, { autoSellPortionPercent: pct });
                                    }}
                                    className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-sm'
                                        : 'bg-slate-900/80 text-slate-400 border border-white/5 hover:text-white hover:bg-slate-800'
                                    }`}
                                  >
                                    {pct}%
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Control 2: Jito Priority Fee & Anti-MEV */}
                      <div className="p-3 rounded-xl bg-[#070A14]/90 border border-white/8 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Shield className="w-3.5 h-3.5 text-purple-400" />
                            <div>
                              <span className="text-xs font-mono font-bold text-white tracking-wide">
                                Jito Priority Fee & MEV Shield
                              </span>
                              <p className="text-[10px] text-purple-300/80 font-mono">
                                Validator block tip for frontrun protection
                              </p>
                            </div>
                          </div>

                          {/* Anti-MEV Toggle */}
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-slate-400 uppercase">
                              {(pos.antiMevEnabled ?? true) ? 'Bundle' : 'Public'}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                haptics.selection();
                                const nextVal = !(pos.antiMevEnabled ?? true);
                                onUpdatePositionStrategy?.(pos.id, { antiMevEnabled: nextVal });
                              }}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                                (pos.antiMevEnabled ?? true)
                                  ? 'bg-purple-600 shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                                  : 'bg-slate-800'
                              }`}
                              aria-label="Toggle Anti-MEV Bundle"
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                  (pos.antiMevEnabled ?? true) ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Priority Tip Presets */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                            Jito Tip:
                          </span>
                          <div className="flex items-center gap-1.5">
                            {[
                              { label: '0.001', sol: 0.001, tier: 'Norm' },
                              { label: '0.005', sol: 0.005, tier: 'Fast' },
                              { label: '0.015', sol: 0.015, tier: 'Turbo' },
                              { label: '0.030', sol: 0.030, tier: 'Leader' }
                            ].map((tip) => {
                              const isSelected = (pos.jitoPriorityFeeSol ?? 0.005) === tip.sol;
                              return (
                                <button
                                  key={tip.label}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    haptics.selection();
                                    onUpdatePositionStrategy?.(pos.id, { jitoPriorityFeeSol: tip.sol });
                                  }}
                                  className={`px-2 py-1 text-[10px] font-mono font-bold rounded-lg transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-purple-500/25 text-purple-300 border border-purple-500/60 shadow-sm'
                                      : 'bg-slate-900/80 text-slate-400 border border-white/5 hover:text-white hover:bg-slate-800'
                                  }`}
                                >
                                  {tip.label} <span className="text-[8px] opacity-70">SOL</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Control 3: Trailing Stop Status & Buffer Calibrator */}
                      <div className="p-3 rounded-xl bg-[#070A14]/90 border border-white/8 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                            <div>
                              <span className="text-xs font-mono font-bold text-white tracking-wide">
                                Trailing Stop Guard
                              </span>
                              <p className="text-[10px] text-cyan-300/80 font-mono">
                                Ratchets up with peak · Reflects on D3 chart
                              </p>
                            </div>
                          </div>

                          {/* Trailing Stop Status Toggle */}
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[9px] font-mono uppercase font-bold ${
                                (pos.trailingStopActive ?? true) ? 'text-emerald-400' : 'text-slate-500'
                              }`}
                            >
                              {(pos.trailingStopActive ?? true) ? 'Active' : 'Paused'}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                haptics.selection();
                                const nextActive = !(pos.trailingStopActive ?? true);
                                onUpdatePositionStrategy?.(pos.id, { trailingStopActive: nextActive });
                              }}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                                (pos.trailingStopActive ?? true)
                                  ? 'bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                                  : 'bg-slate-800'
                              }`}
                              aria-label="Toggle Trailing Stop Guard"
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                  (pos.trailingStopActive ?? true) ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Trailing Stop Buffer & Stepper */}
                        <div className="pt-2 border-t border-white/5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono text-slate-400 uppercase">Buffer:</span>
                              <span className="text-xs font-mono font-black text-red-400">
                                -{pos.trailingStopPercent}%
                              </span>
                              <span className="text-[10px] font-mono text-slate-500">
                                (${pos.stopPriceUsd.toFixed(6)})
                              </span>
                            </div>

                            {/* Stepper [-] and [+] */}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  haptics.selection();
                                  const nextPct = Math.max(3, pos.trailingStopPercent - 1);
                                  onUpdatePositionStrategy?.(pos.id, {
                                    trailingStopPercent: nextPct,
                                    stopPriceUsd: pos.highestPriceUsd * (1 - nextPct / 100)
                                  });
                                }}
                                disabled={pos.trailingStopPercent <= 3}
                                className="w-7 h-7 rounded-lg bg-slate-900 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none active:scale-95 cursor-pointer"
                                aria-label="Decrease trailing stop buffer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  haptics.selection();
                                  const nextPct = Math.min(50, pos.trailingStopPercent + 1);
                                  onUpdatePositionStrategy?.(pos.id, {
                                    trailingStopPercent: nextPct,
                                    stopPriceUsd: pos.highestPriceUsd * (1 - nextPct / 100)
                                  });
                                }}
                                disabled={pos.trailingStopPercent >= 50}
                                className="w-7 h-7 rounded-lg bg-slate-900 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none active:scale-95 cursor-pointer"
                                aria-label="Increase trailing stop buffer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Preset Buffer Chips */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[5, 8, 12, 15, 20, 25].map((pct) => {
                              const isSelected = pos.trailingStopPercent === pct;
                              return (
                                <button
                                  key={pct}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    haptics.selection();
                                    onUpdatePositionStrategy?.(pos.id, {
                                      trailingStopPercent: pct,
                                      stopPriceUsd: pos.highestPriceUsd * (1 - pct / 100)
                                    });
                                  }}
                                  className={`flex-1 min-w-[42px] py-1 text-[10px] font-mono font-bold rounded-lg transition-all text-center cursor-pointer ${
                                    isSelected
                                      ? 'bg-red-500/25 text-red-300 border border-red-500/60 shadow-sm'
                                      : 'bg-slate-900/80 text-slate-400 border border-white/5 hover:text-white hover:bg-slate-800'
                                  }`}
                                >
                                  -{pct}%
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Control 4: Smart Profit Lock (Auto-Trail on Profit Targets) */}
                      <div className="p-3 sm:p-3.5 rounded-xl bg-gradient-to-br from-[#061416]/95 via-[#071C1E]/95 to-[#092426]/95 border border-emerald-500/35 space-y-3 shadow-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              <Lock className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-mono font-bold text-white tracking-wide">
                                  Smart Profit Lock (Auto-Trail)
                                </span>
                                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 font-bold">
                                  AUTO-RATCHET
                                </span>
                              </div>
                              <p className="text-[10px] text-emerald-300/80 font-mono">
                                Stop-loss automatically tightens as price hits each TP tier
                              </p>
                            </div>
                          </div>

                          {/* Toggle Switch */}
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[9px] font-mono uppercase font-bold ${
                                (pos.smartProfitLockEnabled ?? true) ? 'text-emerald-400' : 'text-slate-500'
                              }`}
                            >
                              {(pos.smartProfitLockEnabled ?? true) ? 'Active' : 'Disabled'}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                haptics.selection();
                                const nextVal = !(pos.smartProfitLockEnabled ?? true);
                                onUpdatePositionStrategy?.(pos.id, { smartProfitLockEnabled: nextVal });
                              }}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none cursor-pointer ${
                                (pos.smartProfitLockEnabled ?? true)
                                  ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                                  : 'bg-slate-800'
                              }`}
                              aria-label="Toggle Smart Profit Lock"
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${
                                  (pos.smartProfitLockEnabled ?? true) ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Ratcheting Mode Selector */}
                        <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-white/5 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                            Ratcheting Engine:
                          </span>
                          <div className="flex items-center gap-1">
                            {[
                              { id: 'BREAKEVEN_SHIELD', label: '🛡️ Breakeven Shield' },
                              { id: 'AGGRESSIVE_RATCHET', label: '⚡ Aggressive' },
                              { id: 'HYPER_RUNNER', label: '🚀 Runner' }
                            ].map((mode) => {
                              const isSelected = (pos.smartProfitLockMode ?? 'BREAKEVEN_SHIELD') === mode.id;
                              return (
                                <button
                                  key={mode.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    haptics.selection();
                                    onUpdatePositionStrategy?.(pos.id, {
                                      smartProfitLockMode: mode.id as Position['smartProfitLockMode']
                                    });
                                  }}
                                  className={`px-2 py-1 text-[10px] font-mono font-bold rounded-lg transition-all cursor-pointer ${
                                    isSelected
                                      ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/60 shadow-sm'
                                      : 'bg-slate-900/80 text-slate-400 border border-white/5 hover:text-white hover:bg-slate-800'
                                  }`}
                                >
                                  {mode.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Live Ratchet Roadmap & Tiers */}
                        <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                            <span className="uppercase tracking-wider">Auto-Trail TP Ladder:</span>
                            <span className="text-emerald-400 font-bold">
                              {pos.stopPriceUsd >= pos.entryPriceUsd
                                ? `Guaranteed Floor: +${(((pos.stopPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100).toFixed(1)}%`
                                : 'Awaiting TP1 strike to lock risk-free'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 font-mono text-xs">
                            {pos.takeProfitTiers.map((tier) => {
                              const isHit = tier.hit;
                              const floorPct = tier.lockFloorPercent ?? (tier.tier === 1 ? 2 : tier.tier === 2 ? 35 : 80);
                              const trailBuffer = tier.tightenedTrailingPercent ?? (tier.tier === 1 ? 10 : tier.tier === 2 ? 6 : 3.5);

                              return (
                                <div
                                  key={tier.tier}
                                  className={`p-2 rounded-xl border transition-all ${
                                    isHit
                                      ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                                      : 'bg-slate-950/60 border-white/8 text-slate-300'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider">
                                      Tier {tier.tier} (+{tier.targetPercent}%)
                                    </span>
                                    {isHit ? (
                                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/30 text-emerald-300 font-bold flex items-center gap-0.5">
                                        <Check className="w-2.5 h-2.5" /> LOCKED
                                      </span>
                                    ) : (
                                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-bold">
                                        PENDING
                                      </span>
                                    )}
                                  </div>

                                  <div className="mt-1 space-y-0.5 text-[10px]">
                                    <div className="flex items-center justify-between">
                                      <span className="text-slate-500">Stop Floor:</span>
                                      <span className={isHit ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                                        +{floorPct}% ({tier.tier === 1 ? 'BE+Fee' : 'Profit'})
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-slate-500">Trailing Trail:</span>
                                      <span className={isHit ? 'text-cyan-400 font-bold' : 'text-slate-300'}>
                                        -{trailBuffer}% buffer
                                      </span>
                                    </div>
                                  </div>

                                  {/* Test Simulate TP Hit Button */}
                                  {!isHit && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSimulateTier(pos, tier);
                                      }}
                                      className="mt-1.5 w-full py-1 text-[9px] font-bold uppercase rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1"
                                      title={`Test triggering TP${tier.tier} strike and locking profit floor`}
                                    >
                                      <span>⚡ Test Hit TP{tier.tier}</span>
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Quick Summary Pill Bar */}
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1">
                        <div className="p-2 rounded-xl bg-slate-950/70 border border-white/5 flex items-center justify-between">
                          <span className="text-slate-500 uppercase">Routing:</span>
                          <span className="text-white font-bold">{pos.dex} Direct</span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/70 border border-white/5 flex items-center justify-between">
                          <span className="text-slate-500 uppercase">Exit Yield:</span>
                          <span className="text-emerald-400 font-bold">
                            {pos.currentSolValue.toFixed(2)} SOL (${(pos.currentSolValue * 165.25).toFixed(1)})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 3. 'Scanner Sync' Status Indicator */}
                    <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[#060D1A]/95 to-[#081524]/95 border border-cyan-500/25 space-y-2.5 shadow-lg">
                      <div className="flex items-center justify-between border-b border-white/8 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="relative flex items-center justify-center w-6 h-6 rounded-lg bg-cyan-500/15 border border-cyan-500/30">
                            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                          </div>
                          <div>
                            <span className="text-xs font-mono font-bold text-white uppercase tracking-wider block leading-tight">
                              Mempool Scanner Sync Status
                            </span>
                            <span className="text-[10px] text-cyan-300 font-mono">
                              L1 Sub-Slot Synchronized (Slot #312849132)
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded-md border border-cyan-500/40 font-bold">
                          28ms Latency
                        </span>
                      </div>

                      {/* 60s Flow Volume Pressure Gauge */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-slate-400">60s Buy/Sell Flow Volume:</span>
                          <span className="text-emerald-400 font-bold">74% Buys / 26% Sells (Strong Accumulation)</span>
                        </div>
                        <div className="h-2 w-full bg-red-950/80 rounded-full overflow-hidden flex border border-white/5">
                          <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300" style={{ width: '74%' }} />
                          <div className="h-full bg-red-500/90 transition-all duration-300" style={{ width: '26%' }} />
                        </div>
                      </div>

                      {/* Telemetry checks strip */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-0.5">
                        <div className="flex items-center gap-1.5 text-slate-300 bg-slate-950/60 p-2 rounded-xl border border-white/5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-white font-semibold block">Whale Flow: Accumulating</span>
                            <span className="text-[9px] text-slate-400">0 dump txs in 15m</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-slate-300 bg-slate-950/60 p-2 rounded-xl border border-white/5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <div className="truncate">
                            <span className="text-white font-semibold block">Pool Spread: 0.02%</span>
                            <span className="text-[9px] text-slate-400">{pos.dex} deep liquidity</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action Buttons: Sell 25%, 50%, 100%, Adjust Stop, Alert */}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                <button
                  onClick={() => {
                    haptics.medium();
                    onSellPosition(pos.id, 25);
                  }}
                  className="py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-mono font-semibold text-slate-200 transition-all active:scale-95"
                >
                  25%
                </button>
                <button
                  onClick={() => {
                    haptics.medium();
                    onSellPosition(pos.id, 50);
                  }}
                  className="py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-mono font-semibold text-slate-200 transition-all active:scale-95"
                >
                  50%
                </button>
                <button
                  onClick={() => {
                    haptics.heavy();
                    onSellPosition(pos.id, 100);
                  }}
                  className="py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-[11px] font-mono font-bold text-red-300 transition-all active:scale-95"
                >
                  100%
                </button>
                <button
                  onClick={() => {
                    haptics.selection();
                    setEditingStopPosition(pos);
                    setTempTrailingPercent(pos.trailingStopPercent);
                  }}
                  className="py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-white/10 text-[11px] font-mono text-amber-400 flex items-center justify-center gap-1 transition-all active:scale-95"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Stop</span>
                </button>
                <button
                  onClick={() => handleOpenAlertModal(pos)}
                  className="py-1.5 rounded-lg bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 text-[11px] font-mono text-cyan-300 flex items-center justify-center gap-1 transition-all active:scale-95"
                >
                  <Bell className="w-3 h-3" />
                  <span>Alert</span>
                </button>
              </div>
            </motion.div>
          );
        })}

        {positions.length === 0 && (
          <div className="glass-panel rounded-2xl p-8 text-center border border-white/8 space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center mx-auto text-slate-500">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-mono font-bold text-white">No Open Positions</h4>
            <p className="text-xs text-slate-400">
              Use the Signal Stream tab to trigger instant 1-tap snipes or configure the auto-sniper.
            </p>
          </div>
        )}
      </div>

      {/* Adjust Trailing Stop Modal */}
      {editingStopPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-sm glass-panel-elevated rounded-2xl p-5 border border-white/12 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/8 pb-2">
              <h4 className="text-sm font-bold font-mono text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                Adjust Trailing Stop: ${editingStopPosition.symbol}
              </h4>
              <button
                onClick={() => setEditingStopPosition(null)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Trailing Stop Buffer:</span>
                <span className="text-emerald-400 font-bold text-sm">{tempTrailingPercent}%</span>
              </div>

              <input
                type="range"
                min="5"
                max="35"
                step="1"
                value={tempTrailingPercent}
                onChange={(e) => setTempTrailingPercent(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500"
              />

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>5% (Tight)</span>
                <span>20% (Balanced)</span>
                <span>35% (Moonbag)</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/70 border border-white/5 text-[11px] font-mono text-slate-300">
                Calculated Stop Price: ${' '}
                <span className="text-red-400 font-bold">
                  {(
                    editingStopPosition.highestPriceUsd *
                    (1 - tempTrailingPercent / 100)
                  ).toFixed(6)}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => setEditingStopPosition(null)}
                  className="flex-1 py-2 rounded-xl border border-white/10 text-xs font-mono text-slate-400 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    haptics.success();
                    onUpdateTrailingStop(editingStopPosition.id, tempTrailingPercent);
                    setEditingStopPosition(null);
                  }}
                  className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs font-mono glow-emerald"
                >
                  Save Stop Loss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Set Custom Price Alert Modal (Take Profit or Stop Loss) */}
      {alertPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-sm glass-panel-elevated rounded-2xl p-5 border border-white/12 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/8 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">
                  <BellRing className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold font-mono text-white">
                    Set Price Alert: ${alertPosition.symbol}
                  </h4>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Current: ${alertPosition.currentPriceUsd.toFixed(6)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setAlertPosition(null)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                ✕
              </button>
            </div>

            {/* Alert Type Segmented Switch: Take Profit vs Stop Loss */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-white/8">
              <button
                onClick={() => {
                  haptics.selection();
                  setAlertType('TAKE_PROFIT');
                  const nextP = (alertPosition.currentPriceUsd * 1.5).toFixed(6);
                  setAlertTargetPrice(nextP);
                }}
                className={`py-2 rounded-lg text-xs font-mono font-bold transition-all ${
                  alertType === 'TAKE_PROFIT'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Take Profit (Above)
              </button>
              <button
                onClick={() => {
                  haptics.selection();
                  setAlertType('STOP_LOSS');
                  const nextP = (alertPosition.currentPriceUsd * 0.85).toFixed(6);
                  setAlertTargetPrice(nextP);
                }}
                className={`py-2 rounded-lg text-xs font-mono font-bold transition-all ${
                  alertType === 'STOP_LOSS'
                    ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Stop Loss (Below)
              </button>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono text-slate-400 uppercase">
                Quick Target Presets:
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {alertType === 'TAKE_PROFIT'
                  ? [20, 50, 100, 200].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => handleApplyPresetDelta(pct)}
                        className="py-1.5 rounded-lg bg-slate-900 border border-white/8 hover:border-emerald-500/40 text-xs font-mono font-bold text-emerald-400 active:scale-95 transition-all"
                      >
                        +{pct}%
                      </button>
                    ))
                  : [-10, -20, -30, -50].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => handleApplyPresetDelta(pct)}
                        className="py-1.5 rounded-lg bg-slate-900 border border-white/8 hover:border-red-500/40 text-xs font-mono font-bold text-red-400 active:scale-95 transition-all"
                      >
                        {pct}%
                      </button>
                    ))}
              </div>
            </div>

            {/* Target Price Numeric Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">Target Trigger Price (USD):</span>
                <span
                  className={`font-bold ${
                    alertType === 'TAKE_PROFIT' ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {(() => {
                    const p = parseFloat(alertTargetPrice);
                    if (isNaN(p) || p <= 0) return '';
                    const d =
                      ((p - alertPosition.currentPriceUsd) / alertPosition.currentPriceUsd) * 100;
                    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
                  })()}
                </span>
              </div>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-slate-500 font-mono text-xs">$</span>
                <input
                  type="number"
                  step="0.000001"
                  value={alertTargetPrice}
                  onChange={(e) => setAlertTargetPrice(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-cyan-500/60"
                  placeholder="0.000000"
                />
              </div>
            </div>

            {/* Optional Execution Action Trigger */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[10px] font-mono text-slate-400 uppercase">
                Action on Trigger:
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: 'Alert Only', val: 0 },
                  { label: 'Auto-Sell 50%', val: 50 },
                  { label: 'Auto-Sell 100%', val: 100 }
                ].map((act) => (
                  <button
                    key={act.val}
                    onClick={() => {
                      haptics.selection();
                      setAlertAutoSell(act.val);
                    }}
                    className={`py-1.5 px-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                      alertAutoSell === act.val
                        ? 'bg-purple-500/25 border border-purple-500/50 text-purple-300'
                        : 'bg-slate-900 border border-white/5 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {act.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirmation Buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-white/8">
              <button
                onClick={() => setAlertPosition(null)}
                className="flex-1 py-2 rounded-xl border border-white/10 text-xs font-mono text-slate-400 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAlert}
                className="flex-1 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs font-mono glow-cyan transition-all active:scale-95 shadow-md shadow-cyan-500/20"
              >
                Set Alert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Alerts Overlay Matrix Center */}
      <ActiveAlertsOverlay
        isOpen={isAlertsOverlayOpen}
        onClose={() => setIsAlertsOverlayOpen(false)}
        positions={positions}
        onDeletePriceAlert={onDeletePriceAlert}
        onTestTriggerAlert={onTestTriggerAlert}
        onClearAllAlerts={onClearAllAlerts}
        onClearAlertsByType={onClearAlertsByType}
        onTriggerAllAlerts={onTriggerAllAlerts}
      />
    </div>
  );
};
