/**
 * Tab 4: Analytics & 2x Slippage Stress Report
 * Full visualization of equity curves (1x vs 2x slippage stress), exit reason breakdowns,
 * skip reason telemetry, unresolved stress analysis, and JSONL / JSON export & import.
 */

import React, { useRef, useState } from 'react';
import {
  BarChart3,
  Download,
  Upload,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  FileText,
  RotateCcw,
  CheckCircle,
  HelpCircle,
  Layers,
} from 'lucide-react';
import { engine } from '../services/engine';
import { StorageService } from '../services/storage';
import { ExitReason, SkipReason } from '../types';

export const TabAnalytics: React.FC = () => {
  const stats = engine.getStats();
  const equityPoints = engine.getEquityCurvePoints();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // SVG Chart Dimensions & Calculation
  const chartWidth = 700;
  const chartHeight = 220;
  const padding = { top: 20, right: 30, bottom: 30, left: 50 };

  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  let minEq = 100;
  let maxEq = 100;

  for (const pt of equityPoints) {
    if (pt.equity1x < minEq) minEq = pt.equity1x;
    if (pt.equity1x > maxEq) maxEq = pt.equity1x;
    if (pt.equity2x < minEq) minEq = pt.equity2x;
    if (pt.equity2x > maxEq) maxEq = pt.equity2x;
  }

  // Add 10% vertical padding
  const eqRange = Math.max(10, maxEq - minEq);
  const yMin = Math.floor(Math.max(0, minEq - eqRange * 0.1));
  const yMax = Math.ceil(maxEq + eqRange * 0.1);

  const getX = (index: number) => {
    if (equityPoints.length <= 1) return padding.left;
    return padding.left + (index / (equityPoints.length - 1)) * innerWidth;
  };

  const getY = (val: number) => {
    return padding.top + innerHeight - ((val - yMin) / (yMax - yMin)) * innerHeight;
  };

  const path1x = equityPoints
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx).toFixed(1)} ${getY(pt.equity1x).toFixed(1)}`)
    .join(' ');

  const path2x = equityPoints
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx).toFixed(1)} ${getY(pt.equity2x).toFixed(1)}`)
    .join(' ');

  // Export handlers
  const handleExportJsonl = () => {
    const closed = engine.getClosedTrades();
    const content = StorageService.exportPaperJsonl(closed);
    const blob = new Blob([content], { type: 'application/x-jsonlines' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper-trades-${new Date().toISOString().slice(0, 10)}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPositionsJson = () => {
    const open = engine.getOpenPositions();
    const content = StorageService.exportPositionsJson(open);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paper-positions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const text = event.target?.result as string;
      if (!text) return;

      try {
        const imported = StorageService.importPaperJsonl(text);
        if (imported.length > 0) {
          engine.loadBenchmarkTrades(imported);
          setImportStatus(`Successfully loaded ${imported.length} trades from file.`);
        } else {
          setImportStatus('No valid closed trade records found in file.');
        }
      } catch (err: any) {
        setImportStatus(`Import failed: ${err.message}`);
      }
      setTimeout(() => setImportStatus(null), 4000);
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    if (confirm('Are you sure you want to reset all paper trade history, logs, and positions?')) {
      engine.resetData();
    }
  };

  return (
    <div className="space-y-4 pb-20 font-mono text-xs">
      
      {/* Top Controls: Export / Import / Clear */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#111827] border border-[#1F2937] p-3 rounded-xl">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-sm text-white">Statistical Stress Report</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportJsonl}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
            title="Export closed trades as JSONL (matching report.js format)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>paper.jsonl</span>
          </button>

          <button
            onClick={handleExportPositionsJson}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
            title="Export open positions as positions.json"
          >
            <Download className="w-3.5 h-3.5" />
            <span>positions.json</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-emerald-500/30 transition-colors cursor-pointer"
            title="Import paper.jsonl file"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import JSONL</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jsonl,.json,.txt"
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            onClick={handleResetData}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-800/40 transition-colors cursor-pointer ml-auto"
            title="Reset paper state"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {importStatus && (
        <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-emerald-300">
          {importStatus}
        </div>
      )}

      {/* Equity Curve Chart (10% Stake per Trade: 1x vs 2x Slippage) */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <div className="font-bold text-sm text-white">
              Fixed-Fractional Equity Curve (10% Stake, Starting Index 100)
            </div>
            <div className="text-[11px] text-zinc-400">
              Comparing Standard 1x Slippage vs Pessimistic 2x Slippage Stress
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <span className="w-3 h-0.5 bg-emerald-400 rounded-full" />
              <span>1x Slippage (Current: {stats.currentEquity1x.toFixed(1)})</span>
            </div>
            <div className="flex items-center gap-1.5 text-purple-400">
              <span className="w-3 h-0.5 bg-purple-400 rounded-full" />
              <span>2x Stress (Current: {stats.currentEquity2x.toFixed(1)})</span>
            </div>
          </div>
        </div>

        {/* SVG Equity Chart */}
        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full h-auto min-w-[500px]"
          >
            {/* Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
              const y = padding.top + innerHeight * (1 - pct);
              const val = Math.round(yMin + (yMax - yMin) * pct);
              return (
                <g key={i}>
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={chartWidth - padding.right}
                    y2={y}
                    stroke="#1F2937"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={padding.left - 8}
                    y={y + 4}
                    fill="#6B7280"
                    fontSize="10"
                    textAnchor="end"
                    fontFamily="monospace"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Baseline 100 Reference */}
            {100 >= yMin && 100 <= yMax && (
              <line
                x1={padding.left}
                y1={getY(100)}
                x2={chartWidth - padding.right}
                y2={getY(100)}
                stroke="#374151"
                strokeWidth="1.5"
              />
            )}

            {/* 2x Slippage Curve (Purple) */}
            {equityPoints.length > 1 && (
              <path
                d={path2x}
                fill="none"
                stroke="#9945FF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
              />
            )}

            {/* 1x Slippage Curve (Emerald) */}
            {equityPoints.length > 1 && (
              <path
                d={path1x}
                fill="none"
                stroke="#10B981"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Trade Count Axis Labels */}
            <text
              x={padding.left}
              y={chartHeight - 8}
              fill="#6B7280"
              fontSize="10"
              fontFamily="monospace"
            >
              Trade #0
            </text>
            <text
              x={chartWidth - padding.right}
              y={chartHeight - 8}
              fill="#6B7280"
              fontSize="10"
              textAnchor="end"
              fontFamily="monospace"
            >
              Trade #{equityPoints.length - 1}
            </text>
          </svg>
        </div>
      </div>

      {/* Slippage & Statistical Robustness Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        
        {/* Left: 1x vs 2x Slippage Metrics Table */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
          <div className="font-bold text-sm text-white mb-2">
            Execution Slippage Stress Model
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-[11px]">
                <th className="py-2">Metric</th>
                <th className="py-2 text-right">Standard (1x)</th>
                <th className="py-2 text-right">Stress Test (2x)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              <tr>
                <td className="py-2 text-zinc-400">Entry Slippage Assumption</td>
                <td className="py-2 text-right text-white">5.0%</td>
                <td className="py-2 text-right text-purple-400">10.0%</td>
              </tr>
              <tr>
                <td className="py-2 text-zinc-400">Exit Slippage Assumption</td>
                <td className="py-2 text-right text-white">8.0%</td>
                <td className="py-2 text-right text-purple-400">16.0%</td>
              </tr>
              <tr>
                <td className="py-2 text-zinc-400">Mean Trade PnL</td>
                <td className={`py-2 text-right font-bold ${stats.meanPnl1x >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.meanPnl1x >= 0 ? '+' : ''}{stats.meanPnl1x.toFixed(2)}%
                </td>
                <td className={`py-2 text-right font-bold ${stats.meanPnl2x >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.meanPnl2x >= 0 ? '+' : ''}{stats.meanPnl2x.toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td className="py-2 text-zinc-400">Median Trade PnL</td>
                <td className={`py-2 text-right font-bold ${stats.medianPnl1x >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.medianPnl1x >= 0 ? '+' : ''}{stats.medianPnl1x.toFixed(2)}%
                </td>
                <td className={`py-2 text-right font-bold ${stats.medianPnl2x >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {stats.medianPnl2x >= 0 ? '+' : ''}{stats.medianPnl2x.toFixed(2)}%
                </td>
              </tr>
              <tr>
                <td className="py-2 text-zinc-400">Max Equity Drawdown</td>
                <td className="py-2 text-right text-white font-bold">{stats.maxDrawdownPct1x.toFixed(1)}%</td>
                <td className="py-2 text-right text-purple-400 font-bold">{stats.maxDrawdownPct2x.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Right: Unresolved Quotes Worst-Case Estimate */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
          <div className="font-bold text-sm text-white mb-2">
            Worst-Case Unresolved Stress Estimate
          </div>
          <p className="text-[11px] text-zinc-400 mb-3">
            Simulates worst-case scenario where all {stats.unresolvedCount} unresolved quote positions took an immediate -25% stop-loss under 2x slippage.
          </p>

          <div className="space-y-2">
            <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <span className="text-zinc-400">Stressed Mean PnL:</span>
              <span className={`font-bold ${stats.stressedMeanPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.stressedMeanPnl >= 0 ? '+' : ''}{stats.stressedMeanPnl.toFixed(2)}%
              </span>
            </div>

            <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <span className="text-zinc-400">Stressed Median PnL:</span>
              <span className={`font-bold ${stats.stressedMedianPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {stats.stressedMedianPnl >= 0 ? '+' : ''}{stats.stressedMedianPnl.toFixed(2)}%
              </span>
            </div>

            <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-between">
              <span className="text-zinc-400">Evaluation Gate Criteria:</span>
              <span className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                stats.evaluationGatePassed
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {stats.evaluationGatePassed ? 'PASS' : 'INCOMPLETE/FAIL'}
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Breakdown Tables: Exit Reasons & Skip Reasons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        
        {/* Exit Reason Breakdown */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
          <div className="font-bold text-sm text-white mb-2">
            Exit Reason Distribution
          </div>
          <div className="space-y-2">
            {Object.entries(stats.exitReasonCounts).map(([reason, count]) => {
              const pct = stats.closedCount > 0 ? (count / stats.closedCount) * 100 : 0;
              return (
                <div key={reason} className="space-y-1">
                  <div className="flex items-center justify-between text-zinc-300">
                    <span className="capitalize">{reason.replace('_', ' ')}</span>
                    <span className="font-bold">{count} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        reason === 'trailing_stop'
                          ? 'bg-emerald-400'
                          : reason === 'stop_loss'
                          ? 'bg-red-400'
                          : reason === 'unresolved'
                          ? 'bg-amber-400'
                          : 'bg-zinc-400'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Skip Reason Breakdown */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
          <div className="font-bold text-sm text-white mb-2">
            Signal Filter & Skip Telemetry
          </div>
          <div className="space-y-2">
            {Object.entries(stats.skipReasonCounts).map(([reason, count]) => {
              return (
                <div key={reason} className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80">
                  <span className="text-zinc-400 capitalize">{reason.replace('_', ' ')}</span>
                  <span className="font-bold text-white bg-zinc-800 px-2 py-0.5 rounded text-[11px]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>

    </div>
  );
};
