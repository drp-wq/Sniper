/**
 * Sniper Bot (Paper-Only Solana Scanner & Paper Trader) Types
 * Strict paper trading contract & on-chain gate schema
 */

export interface AppConfig {
  workerUrl: string;
  appKey: string;
  rpcUrl: string;
  pollIntervalMs: number;       // default 3000ms
  priceIntervalMs: number;      // default 5000ms
  maxOpen: number;              // default 5
  minLiqUsd: number;            // default 15000
  maxTop10Pct: number;          // default 35 (%)
  entrySlip: number;            // default 0.05 (5%)
  exitSlip: number;             // default 0.08 (8%)
  stopLossPct: number;          // default -25 (%)
  takeProfitHalfPct: number;    // default 100 (%)
  trailingStopArmPct: number;   // default 50 (%)
  trailingStopPullbackPct: number; // default 20 (%) -> exit when px <= peak * 0.80
  timeStopWindowSec: number;    // default 180s
  maxHoldSec: number;           // default 1800s (30m)
  stakeUsdDefault: number;      // default 100 ($)
  soundAlerts: boolean;
  wakeLockEnabled: boolean;
}

export interface ToastMessage {
  id: string;
  type: 'buy' | 'tp' | 'sl' | 'info' | 'warn';
  title: string;
  message: string;
  timestamp: number;
}

export interface WorkerSignal {
  id: number;
  mint: string;
  sig: string;
  ts: number;
  chainTs?: number;
}

export interface SignalsResponse {
  signals: WorkerSignal[];
  seq: number;
  oldestId: number;
  halt: boolean;
}

export interface WorkerExportKv {
  queue: {
    seq: number;
    halt: boolean;
    items: WorkerSignal[];
  };
  hb: {
    ts: number;
    open: number;
  };
  alerted: boolean;
  alertedUntil: number;
  alertedRemainingSec: number;
  alertedTtlSec: number;
}

export interface GateStepResult {
  step: string;
  passed: boolean;
  detail: string;
  data?: any;
}

export interface GateVerdict {
  mint: string;
  passed: boolean;
  reasons: string[];
  steps: GateStepResult[];
  supply?: number;
  top10Pct?: number;
  top10Wallets?: { address: string; pct: number; isVault?: boolean }[];
  isToken2022?: boolean;
  activeExtensions?: string[];
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  checkedAt: number;
}

export interface DexQuote {
  mint: string;
  symbol: string;
  name: string;
  pairAddress: string;
  priceUsd: number;
  liqUsd: number;
  volume24h?: number;
  priceChange24h?: number;
  dexId?: string;
  updatedAt: number;
}

export type ExitReason =
  | 'stop_loss'
  | 'liquidity_drop'
  | 'max_hold'
  | 'trailing_stop'
  | 'time_stop'
  | 'unresolved'
  | 'manual_close';

export type SkipReason =
  | 'stale_signal'
  | 'position_already_open'
  | 'skip_maxopen'
  | 'skip_liquidity'
  | 'local_halt'
  | 'remote_halt'
  | 'gate_rejected';

export interface PaperPosition {
  id: string;
  signalId?: number;
  mint: string;
  symbol: string;
  name: string;
  sig?: string;
  openedAt: number;
  entryPriceRaw: number;
  entryPrice: number;           // entryPriceRaw * (1 + entrySlip)
  entryLiqUsd: number;
  stakeUsd: number;             // fixed-fractional paper stake ($100 base)
  shares: number;
  
  // Real-time tracking
  currentQuotePrice: number;
  currentLiqUsd: number;
  executablePrice: number;      // currentQuotePrice * (1 - exitSlip)
  unrealizedPnlPct: number;
  unrealizedPnlUsd: number;
  peakExecutablePrice: number;
  peakPnlPct: number;
  
  // Rule flags
  tookHalf: boolean;            // banked 50% at >= +100%
  bankedUsd: number;
  trailingArmed: boolean;       // armed at >= +50%
  missedQuoteTicks: number;     // incremented if DexScreener returns no quote
  isUnresolved: boolean;        // flagged after 12 missed ticks
  
  // Time stop tracking
  enteredBandAt?: number;       // when it entered [-10%, +15%] band
  lastHighAt: number;
  
  priceHistory?: number[];      // last 20 tick prices for sparkline
  lastTickAt: number;
}

export interface ClosedTrade {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  openedAt: number;
  closedAt: number;
  holdSeconds: number;
  
  entryPriceRaw: number;
  entryPrice: number;
  exitPriceRaw: number;
  exitPrice: number;
  
  entryLiqUsd: number;
  exitLiqUsd: number;
  
  exitReason: ExitReason;
  tookHalf: boolean;
  bankedUsd: number;
  
  // 1x Slippage (Standard 5% entry, 8% exit)
  pnlPct1x: number;
  pnlUsd1x: number;
  
  // 2x Slippage Stress (10% entry, 16% exit)
  pnlPct2x: number;
  pnlUsd2x: number;
}

export interface SignalLogItem {
  id: string;
  signalId: number;
  mint: string;
  sig?: string;
  receivedAt: number;
  signalTs: number;
  latencyMs: number;
  status: 'passed' | 'rejected' | 'skipped' | 'entered';
  skipReason?: SkipReason;
  rejectionReasons?: string[];
  gateVerdict?: GateVerdict;
  quote?: DexQuote;
}

export interface EquityPoint {
  tradeIndex: number;
  equity1x: number;
  equity2x: number;
  drawdown1x: number;
  drawdown2x: number;
  timestamp: number;
}

export interface EngineStats {
  openCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  
  meanPnl1x: number;
  medianPnl1x: number;
  meanPnl2x: number;
  medianPnl2x: number;
  
  currentEquity1x: number;
  currentEquity2x: number;
  maxDrawdownPct1x: number;
  maxDrawdownPct2x: number;
  
  stressedMeanPnl: number;
  stressedMedianPnl: number;
  unresolvedCount: number;
  
  exitReasonCounts: Record<ExitReason, number>;
  skipReasonCounts: Record<SkipReason, number>;
  
  evaluationGatePassed: boolean;
}
