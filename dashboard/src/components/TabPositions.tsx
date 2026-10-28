/**
 * Tab 2: Active & Archived Paper Positions
 * Live cards with pessimistic executable prices (-8% slip), hold timers, rule badges,
 * real-time mini price sparklines, Solscan/DexScreener links, manual exit button,
 * and searchable/filterable Closed Trades history.
 */

import React, { useState } from 'react';
import {
  Layers,
  Copy,
  ExternalLink,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Check,
  ShieldCheck,
  XCircle,
  Archive,
  RefreshCw,
  X,
  Search,
  Filter,
  DollarSign,
  Zap,
} from 'lucide-react';
import { engine } from '../services/engine';
import { PaperPosition, ClosedTrade, ExitReason } from '../types';

export const TabPositions: React.FC = () => {
  const [subTab, setSubTab] = useState<'active' | 'closed' | 'unresolved'>('active');
  const [copiedMint, setCopiedMint] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exitReasonFilter, setExitReasonFilter] = useState<string>('all');

  const openPositions = engine.getOpenPositions();
  const closedTrades = engine.getClosedTrades();
  const unresolvedPositions = closedTrades.filter(t => t.exitReason === 'unresolved');
  const config = engine.getConfig();

  const handleCopy = (mint: string) => {
    navigator.clipboard.writeText(mint);
    setCopiedMint(mint);
    setTimeout(() => setCopiedMint(null), 2000);
  };

  const handleManualClose = (id: string) => {
    engine.manualClose(id);
  };

  // Filtered closed trades
  const filteredClosedTrades = closedTrades.filter(t => {
    const matchesSearch =
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.mint.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = exitReasonFilter === 'all' || t.exitReason === exitReasonFilter;
    return matchesSearch && matchesFilter;
  });

  // Render Mini Sparkline for Open Position
  const renderSparkline = (pos: PaperPosition) => {
    const history = pos.priceHistory && pos.priceHistory.length > 1 ? pos.priceHistory : [pos.entryPriceRaw, pos.currentQuotePrice];
    const w = 180;
    const h = 40;
    const min = Math.min(...history, pos.entryPriceRaw * 0.75); // include stop loss
    const max = Math.max(...history, pos.peakExecutablePrice / (1 - config.exitSlip));
    const range = Math.max(0.000001, max - min);

    const points = history.map((p, i) => {
      const x = (i / (history.length - 1)) * w;
      const y = h - ((p - min) / range) * (h - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const entryY = h - ((pos.entryPriceRaw - min) / range) * (h - 8) - 4;
    const isProfitable = pos.unrealizedPnlPct >= 0;

    return (
      <div className="relative w-full max-w-[200px] h-10 bg-zinc-950/60 rounded border border-zinc-800/80 px-1 py-0.5 overflow-hidden">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full">
          {/* Entry Price Dash Reference Line */}
          <line
            x1="0"
            y1={entryY}
            x2={w}
            y2={entryY}
            stroke="#6B7280"
            strokeDasharray="2 2"
            strokeWidth="1"
          />
          {/* Price Path */}
          <polyline
            fill="none"
            stroke={isProfitable ? '#10B981' : '#EF4444'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        </svg>
        <span className="absolute bottom-0.5 right-1 text-[9px] text-zinc-500 font-mono">
          Live Path
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4 pb-20">
      
      {/* Sub-tab Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1F2937] pb-2">
        <div className="flex items-center gap-1 bg-[#111827] p-1 rounded-lg border border-[#1F2937] text-xs font-mono">
          <button
            onClick={() => setSubTab('active')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              subTab === 'active'
                ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Active ({openPositions.length}/{config.maxOpen})
          </button>
          <button
            onClick={() => setSubTab('closed')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              subTab === 'closed'
                ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Closed History ({closedTrades.length})
          </button>
          <button
            onClick={() => setSubTab('unresolved')}
            className={`px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
              subTab === 'unresolved'
                ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Unresolved ({unresolvedPositions.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {subTab === 'active' && (
            <button
              onClick={() => engine.tickPrices()}
              className="flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-emerald-400 px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
              title="Refresh DexScreener quotes now"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Quotes</span>
            </button>
          )}
        </div>
      </div>

      {/* SUB-TAB 1: Active Paper Positions */}
      {subTab === 'active' && (
        <div className="space-y-3">
          {openPositions.length === 0 ? (
            <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center text-zinc-500 font-mono text-xs">
              <Layers className="w-10 h-10 mx-auto mb-2 text-zinc-600" />
              <div className="text-sm font-semibold text-zinc-300">No Open Paper Positions</div>
              <div className="mt-1">
                The scanner will automatically open positions when incoming signals pass the On-Chain Safety Gate and DexScreener Liquidity Filter.
              </div>
              <button
                onClick={() => engine.simulateSignal()}
                className="mt-4 px-3.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-xs font-mono inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Simulate Inbound Test Signal</span>
              </button>
            </div>
          ) : (
            openPositions.map(pos => {
              const isProfitable = pos.unrealizedPnlPct >= 0;
              const holdSec = Math.round((Date.now() - pos.openedAt) / 1000);
              const maxHoldRemaining = Math.max(0, config.maxHoldSec - holdSec);

              return (
                <div
                  key={pos.id}
                  className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 transition-all hover:border-zinc-700 font-mono"
                >
                  {/* Card Header: Symbol, Mint, Copy, Links, Badges */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-bold text-white">{pos.symbol}</span>
                      <span className="text-xs text-zinc-400 truncate max-w-[120px] sm:max-w-none">
                        {pos.name}
                      </span>
                      <div className="flex items-center gap-1 text-[11px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                        <span>{pos.mint.slice(0, 4)}...{pos.mint.slice(-4)}</span>
                        <button
                          onClick={() => handleCopy(pos.mint)}
                          className="hover:text-zinc-200 cursor-pointer"
                          title="Copy mint address"
                        >
                          {copiedMint === pos.mint ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>

                      <a
                        href={`https://dexscreener.com/solana/${pos.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/50"
                      >
                        DexScreener <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                      <a
                        href={`https://solscan.io/token/${pos.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-0.5 bg-purple-950/40 px-2 py-0.5 rounded border border-purple-800/50"
                      >
                        Solscan <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>

                    {/* Rule Badges & Sparkline */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {renderSparkline(pos)}
                      {pos.tookHalf && (
                        <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/40">
                          50% TP BANKED (+100%)
                        </span>
                      )}
                      {pos.trailingArmed && (
                        <span className="text-[10px] font-bold bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/40">
                          TRAIL ARMED (20% Pullback)
                        </span>
                      )}
                      {pos.isUnresolved && (
                        <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/40">
                          UNRESOLVED ({pos.missedQuoteTicks} ticks)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pricing & Performance Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                    <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                      <div className="text-zinc-500 text-[10px]">Entry Price (+5% slip)</div>
                      <div className="font-bold text-white mt-0.5">${pos.entryPrice.toFixed(6)}</div>
                      <div className="text-[10px] text-zinc-500">Raw: ${pos.entryPriceRaw.toFixed(6)} • Stake: ${pos.stakeUsd}</div>
                    </div>

                    <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                      <div className="text-zinc-500 text-[10px]">Executable Price (-8% slip)</div>
                      <div className="font-bold text-white mt-0.5">${pos.executablePrice.toFixed(6)}</div>
                      <div className="text-[10px] text-zinc-500">Dex Quote: ${pos.currentQuotePrice.toFixed(6)}</div>
                    </div>

                    <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                      <div className="text-zinc-500 text-[10px]">Unrealized PnL</div>
                      <div className={`font-bold text-base mt-0.5 ${isProfitable ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfitable ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        Peak: +{pos.peakPnlPct.toFixed(1)}% {pos.bankedUsd > 0 ? `• Banked: $${pos.bankedUsd.toFixed(2)}` : ''}
                      </div>
                    </div>

                    <div className="bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                      <div className="text-zinc-500 text-[10px]">Liquidity & Hold</div>
                      <div className="font-bold text-white mt-0.5">${Math.round(pos.currentLiqUsd).toLocaleString()}</div>
                      <div className="text-[10px] text-zinc-500">
                        Hold: {holdSec}s / 1800s
                      </div>
                    </div>
                  </div>

                  {/* Exit Criteria Triggers & Emergency Close */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-zinc-800/80 text-[11px] text-zinc-400">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span>SL: {config.stopLossPct}%</span>
                      <span>•</span>
                      <span>Trail Arm: +{config.trailingStopArmPct}%</span>
                      <span>•</span>
                      <span>TP 50%: +{config.takeProfitHalfPct}%</span>
                      <span>•</span>
                      <span>Time-Stop: {config.timeStopWindowSec}s</span>
                      <span>•</span>
                      <span>Max-Hold: {maxHoldRemaining}s remaining</span>
                    </div>

                    <button
                      onClick={() => handleManualClose(pos.id)}
                      className="self-end sm:self-auto flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/40 text-red-400 hover:bg-red-900/50 border border-red-800/50 text-xs font-semibold cursor-pointer"
                      title="Manual paper close (operator override)"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Close Paper Position</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SUB-TAB 2: Closed Trades History with Search & Filter */}
      {subTab === 'closed' && (
        <div className="space-y-3 font-mono text-xs">
          
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-[#111827] border border-[#1F2937] p-2.5 rounded-xl">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search symbol or mint..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto text-[11px]">
              <span className="text-zinc-500 flex items-center gap-1">
                <Filter className="w-3 h-3" /> Filter:
              </span>
              {['all', 'trailing_stop', 'stop_loss', 'time_stop', 'liquidity_drop', 'max_hold'].map(reason => (
                <button
                  key={reason}
                  onClick={() => setExitReasonFilter(reason)}
                  className={`px-2 py-1 rounded capitalize cursor-pointer transition-colors ${
                    exitReasonFilter === reason
                      ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                  }`}
                >
                  {reason.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {filteredClosedTrades.length === 0 ? (
            <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center text-zinc-500 font-mono text-xs">
              <Archive className="w-10 h-10 mx-auto mb-2 text-zinc-600" />
              <div>No matching closed trades found.</div>
            </div>
          ) : (
            <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden font-mono text-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-900/90 text-zinc-400 border-b border-zinc-800 text-[11px]">
                      <th className="py-2.5 px-3">Token</th>
                      <th className="py-2.5 px-3">Exit Reason</th>
                      <th className="py-2.5 px-3 text-right">1x PnL %</th>
                      <th className="py-2.5 px-3 text-right">2x Slip PnL %</th>
                      <th className="py-2.5 px-3 text-right">Hold Time</th>
                      <th className="py-2.5 px-3 text-right">Closed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {filteredClosedTrades.map(trade => {
                      const isWin1x = trade.pnlPct1x > 0;
                      const isWin2x = trade.pnlPct2x > 0;
                      return (
                        <tr key={trade.id} className="hover:bg-zinc-900/40">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-white">{trade.symbol}</div>
                            <div className="text-[10px] text-zinc-500">
                              {trade.mint.slice(0, 4)}...{trade.mint.slice(-4)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                trade.exitReason === 'trailing_stop'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : trade.exitReason === 'stop_loss'
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                  : trade.exitReason === 'unresolved'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-zinc-800 text-zinc-300'
                              }`}
                            >
                              {trade.exitReason.toUpperCase()}
                            </span>
                          </td>
                          <td className={`py-2.5 px-3 text-right font-bold ${isWin1x ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isWin1x ? '+' : ''}{trade.pnlPct1x.toFixed(2)}%
                          </td>
                          <td className={`py-2.5 px-3 text-right font-bold ${isWin2x ? 'text-emerald-400' : 'text-red-400'}`}>
                            {isWin2x ? '+' : ''}{trade.pnlPct2x.toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 text-right text-zinc-400">
                            {trade.holdSeconds}s
                          </td>
                          <td className="py-2.5 px-3 text-right text-zinc-500 text-[10px]">
                            {new Date(trade.closedAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: Unresolved Missing Quote Positions */}
      {subTab === 'unresolved' && (
        <div className="space-y-3 font-mono text-xs">
          <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-xl text-amber-300">
            <strong>Safety Protocol:</strong> Positions with missing DexScreener quotes are never fabricated as -100% rug losses. Instead, they are marked unresolved after 12 missed ticks and archived after 30 minutes with transparent stress accounting.
          </div>

          {unresolvedPositions.length === 0 ? (
            <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center text-zinc-500 font-mono text-xs">
              <ShieldCheck className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
              <div>No unresolved quote issues detected. All trades resolved cleanly via DexScreener.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {unresolvedPositions.map(u => (
                <div key={u.id} className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between">
                  <div>
                    <span className="font-bold text-white">{u.symbol}</span>
                    <span className="text-zinc-500 ml-2">{u.mint}</span>
                  </div>
                  <div className="text-amber-400 font-bold">
                    Archived Unresolved ({u.holdSeconds}s)
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
};
