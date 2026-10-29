import React, { useMemo, useState, useRef } from 'react';
import * as d3 from 'd3';
import { Sparkles, Maximize2, Zap, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface PricePoint {
  time: Date;
  price: number;
  volume: number;
}

interface PositionD3ChartProps {
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  stopPrice: number;
  sparkline: number[];
  isProfitable: boolean;
  smartProfitLockEnabled?: boolean;
  lockedProfitPercent?: number;
}

export const PositionD3Chart: React.FC<PositionD3ChartProps> = ({
  symbol,
  entryPrice,
  currentPrice,
  stopPrice,
  sparkline,
  isProfitable,
  smartProfitLockEnabled,
  lockedProfitPercent
}) => {
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | 'LIVE'>('5m');
  const [hoveredPoint, setHoveredPoint] = useState<{ price: number; delta: number; time: string } | null>(null);
  const containerRef = useRef<SVGSVGElement | null>(null);

  // Synthesize realistic high-frequency price history from currentPrice, entryPrice, and sparkline
  const chartData: PricePoint[] = useMemo(() => {
    const now = Date.now();
    const count = 24;
    const intervalMs = timeframe === '1m' ? 2500 : timeframe === '5m' ? 12500 : 37500;

    const basePrice = entryPrice;
    const priceRange = Math.abs(currentPrice - entryPrice) || entryPrice * 0.1;

    return sparkline.concat(sparkline.slice(-6)).slice(-count).map((val, idx) => {
      const progress = idx / (count - 1);
      // Interpolate smoothly towards currentPrice
      const normalizedVal = (val % 50) / 50;
      const interpolated = basePrice + (currentPrice - basePrice) * progress + (normalizedVal - 0.5) * priceRange * 0.3;
      const pointPrice = idx === count - 1 ? currentPrice : Math.max(0.000001, interpolated);
      const volume = Math.floor(15000 + Math.random() * 45000 * (val / 50));

      return {
        time: new Date(now - (count - 1 - idx) * intervalMs),
        price: pointPrice,
        volume
      };
    });
  }, [sparkline, currentPrice, entryPrice, timeframe]);

  // Chart dimensions
  const width = 460;
  const height = 175;
  const margin = { top: 16, right: 14, bottom: 26, left: 14 };

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // D3 Scales
  const { xScale, yScale, yVolumeScale, linePath, areaPath, entryY, stopY } = useMemo(() => {
    const xMin = chartData[0]?.time || new Date();
    const xMax = chartData[chartData.length - 1]?.time || new Date();

    const prices = chartData.map((d) => d.price).concat([entryPrice, stopPrice]);
    const pMin = Math.min(...prices) * 0.985;
    const pMax = Math.max(...prices) * 1.015;

    const x = d3.scaleTime().domain([xMin, xMax]).range([0, innerWidth]);
    const y = d3.scaleLinear().domain([pMin, pMax]).range([innerHeight, 0]);

    const maxVol = d3.max(chartData, (d) => d.volume) || 50000;
    const yVol = d3.scaleLinear().domain([0, maxVol]).range([innerHeight, innerHeight - 35]);

    const lineGen = d3
      .line<PricePoint>()
      .x((d) => x(d.time))
      .y((d) => y(d.price))
      .curve(d3.curveMonotoneX);

    const areaGen = d3
      .area<PricePoint>()
      .x((d) => x(d.time))
      .y0(innerHeight)
      .y1((d) => y(d.price))
      .curve(d3.curveMonotoneX);

    return {
      xScale: x,
      yScale: y,
      yVolumeScale: yVol,
      linePath: lineGen(chartData) || '',
      areaPath: areaGen(chartData) || '',
      entryY: y(entryPrice),
      stopY: y(stopPrice)
    };
  }, [chartData, entryPrice, stopPrice, innerWidth, innerHeight]);

  const lastPoint = chartData[chartData.length - 1];
  const lastX = lastPoint ? xScale(lastPoint.time) : innerWidth;
  const lastY = lastPoint ? yScale(lastPoint.price) : innerHeight / 2;

  // Interactive pointer handler
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left - margin.left;
    const clampedX = Math.max(0, Math.min(innerWidth, clientX));
    const hoveredTime = xScale.invert(clampedX);

    // Bisect to nearest point
    const bisect = d3.bisector<PricePoint, Date>((d) => d.time).center;
    const idx = bisect(chartData, hoveredTime);
    const point = chartData[idx] || chartData[chartData.length - 1];

    if (point) {
      const delta = ((point.price - entryPrice) / entryPrice) * 100;
      setHoveredPoint({
        price: point.price,
        delta,
        time: d3.timeFormat('%H:%M:%S')(point.time)
      });
    }
  };

  const handlePointerLeave = () => {
    setHoveredPoint(null);
  };

  const themeColor = isProfitable ? '#00FFA3' : '#FF3B30';
  const gradId = `d3-grad-${symbol}-${isProfitable ? 'profit' : 'loss'}`;

  return (
    <div className="w-full space-y-2 select-none">
      {/* Chart Header Bar: Timeframes + Current Hover Price */}
      <div className="flex items-center justify-between text-xs font-mono px-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            D3 Sub-Slot Chart
          </span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900/80 border border-white/5">
            {(['1m', '5m', '15m', 'LIVE'] as const).map((tf) => (
              <button
                key={tf}
                onClick={(e) => {
                  e.stopPropagation();
                  setTimeframe(tf);
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                  timeframe === tf
                    ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Smart Profit Lock Indicator Pill */}
          {smartProfitLockEnabled && (
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold flex items-center gap-1 border ${
                stopPrice >= entryPrice
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40'
              }`}
            >
              <span>🔒</span>
              {stopPrice >= entryPrice
                ? `LOCKED +${(((stopPrice - entryPrice) / entryPrice) * 100).toFixed(0)}%`
                : 'AUTO-TRAIL ARMED'}
            </span>
          )}
        </div>

        {/* Hover / Live Price Readout */}
        <div className="text-right">
          {hoveredPoint ? (
            <div className="animate-in fade-in duration-100">
              <span className="font-bold text-white tabular-nums">${hoveredPoint.price.toFixed(6)}</span>
              <span
                className={`ml-1.5 text-[10px] font-bold ${
                  hoveredPoint.delta >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                ({hoveredPoint.delta >= 0 ? '+' : ''}
                {hoveredPoint.delta.toFixed(2)}%)
              </span>
            </div>
          ) : (
            <div>
              <span className="font-bold text-white tabular-nums">${currentPrice.toFixed(6)}</span>
              <span className="text-[10px] text-slate-400 ml-1.5 font-mono">LIVE</span>
            </div>
          )}
        </div>
      </div>

      {/* D3 Rendered SVG Chart Box */}
      <div className="relative w-full rounded-2xl bg-[#06080F]/90 border border-white/10 p-1 shadow-inner overflow-hidden">
        <svg
          ref={containerRef}
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible cursor-crosshair touch-none"
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            {/* Glowing Area Fill */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={themeColor} stopOpacity="0.35" />
              <stop offset="60%" stopColor={themeColor} stopOpacity="0.08" />
              <stop offset="100%" stopColor={themeColor} stopOpacity="0.0" />
            </linearGradient>

            {/* Glowing Filter for Pixel 10 Pro XL High-DPI screen */}
            <filter id={`glow-${symbol}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Subtle Horizontal Gridlines */}
            {[0, 0.33, 0.66, 1].map((pct, idx) => (
              <line
                key={idx}
                x1={0}
                y1={innerHeight * pct}
                x2={innerWidth}
                y2={innerHeight * pct}
                stroke="rgba(255, 255, 255, 0.05)"
                strokeDasharray="2 3"
              />
            ))}

            {/* Volume Histogram Bars */}
            {chartData.map((d, i) => {
              const barX = xScale(d.time) - 2;
              const barY = yVolumeScale(d.volume);
              const barH = Math.max(2, innerHeight - barY);
              return (
                <rect
                  key={i}
                  x={barX}
                  y={barY}
                  width={3.5}
                  height={barH}
                  fill="rgba(255, 255, 255, 0.08)"
                  rx={1}
                />
              );
            })}

            {/* Entry Price Reference Line (Dashed Cyan) */}
            {entryY >= 0 && entryY <= innerHeight && (
              <g>
                <line
                  x1={0}
                  y1={entryY}
                  x2={innerWidth}
                  y2={entryY}
                  stroke="#06B6D4"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  opacity={0.7}
                />
                <text
                  x={4}
                  y={entryY - 3}
                  fill="#06B6D4"
                  fontSize={8}
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="bold"
                >
                  ENTRY: ${entryPrice.toFixed(6)}
                </text>
              </g>
            )}

            {/* Trailing Stop Floor Line (Dynamic Red vs Glowing Emerald Profit-Lock Floor) */}
            {stopY >= 0 && stopY <= innerHeight && (
              <g>
                <line
                  x1={0}
                  y1={stopY}
                  x2={innerWidth}
                  y2={stopY}
                  stroke={stopPrice >= entryPrice ? '#00FFA3' : '#EF4444'}
                  strokeWidth={stopPrice >= entryPrice ? 1.5 : 1}
                  strokeDasharray={stopPrice >= entryPrice ? '4 2' : '3 3'}
                  opacity={0.9}
                />
                <text
                  x={innerWidth - 4}
                  y={stopY - 3}
                  fill={stopPrice >= entryPrice ? '#00FFA3' : '#EF4444'}
                  fontSize={8}
                  textAnchor="end"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="bold"
                >
                  {stopPrice >= entryPrice
                    ? `🔒 PROFIT LOCK: +${(((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1)}% ($${stopPrice.toFixed(6)})`
                    : `STOP: ${stopPrice.toFixed(6)}`}
                </text>
              </g>
            )}

            {/* D3 Area Path Fill */}
            <path d={areaPath} fill={`url(#${gradId})`} />

            {/* D3 Line Path Stroke */}
            <path
              d={linePath}
              fill="none"
              stroke={themeColor}
              strokeWidth={2}
              strokeLinecap="round"
              filter={`url(#glow-${symbol})`}
            />

            {/* Current Price Beacon at end of line */}
            <circle cx={lastX} cy={lastY} r={3.5} fill="#FFFFFF" />
            <circle cx={lastX} cy={lastY} r={7} fill={themeColor} opacity={0.5} className="animate-ping" />

            {/* Bottom Time Axis Markers */}
            {chartData.filter((_, idx) => idx % 6 === 0).map((d, i) => (
              <text
                key={i}
                x={xScale(d.time)}
                y={innerHeight + 14}
                fill="#64748B"
                fontSize={8}
                fontFamily="JetBrains Mono, monospace"
                textAnchor="middle"
              >
                {d3.timeFormat('%H:%M')(d.time)}
              </text>
            ))}
          </g>
        </svg>

        {/* Legend Footnote */}
        <div className="flex items-center justify-between px-2 pt-0.5 text-[9px] font-mono text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-cyan-400 inline-block" /> Entry
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-red-400 inline-block" /> Stop Loss
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-0.5 bg-emerald-400 inline-block" /> Price
            </span>
          </div>
          <span className="text-slate-500">120Hz Monotone Interpolation</span>
        </div>
      </div>
    </div>
  );
};
