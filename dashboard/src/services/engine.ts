/**
 * Core Sniper Bot Paper Trader Engine
 * Manages Signal Polling Loop, On-Chain Gate Pipeline, DexScreener Quotes,
 * Price Tick Loop, Exit Rules, and Analytics calculation.
 */

import {
  AppConfig,
  ClosedTrade,
  EngineStats,
  EquityPoint,
  ExitReason,
  GateVerdict,
  PaperPosition,
  SignalLogItem,
  SkipReason,
  WorkerExportKv,
  WorkerSignal,
} from '../types';
import { DexScreenerService } from './dexScreener';
import { SolanaRpc } from './solanaRpc';
import { StorageService } from './storage';
import { WorkerApi } from './workerApi';

type Listener = () => void;

class SoundManager {
  private ctx: AudioContext | null = null;

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playBuy() {
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, this.ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.00, this.ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.3);
    } catch {}
  }

  playTakeProfit() {
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, this.ctx.currentTime); // E5
      osc.frequency.setValueAtTime(1046.50, this.ctx.currentTime + 0.12); // C6
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.4);
    } catch {}
  }

  playStopLoss() {
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(329.63, this.ctx.currentTime); // E4
      osc.frequency.setValueAtTime(220.00, this.ctx.currentTime + 0.15); // A3
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.35);
    } catch {}
  }
}

export const sounds = new SoundManager();

export class SniperEngine {
  private config: AppConfig;
  private openPositions: PaperPosition[] = [];
  private closedTrades: ClosedTrade[] = [];
  private signalLogs: SignalLogItem[] = [];
  private cursor: number = 0;
  private isLocalHalted: boolean = false;
  private isRemoteHalted: boolean = false;

  private isRunning: boolean = false;
  private pollTimer: any = null;
  private priceTimer: any = null;
  private heartbeatTimer: any = null;
  private wakeLockSentinel: any = null;

  // Diagnostics & Status
  public lastPollAt: number = 0;
  public lastHeartbeatAt: number = 0;
  public lastWorkerLatencyMs: number = 0;
  public workerStatus: 'connected' | 'error' | 'idle' = 'idle';
  public workerErrorMessage: string = '';
  public sequenceGapDetected: boolean = false;
  public latestExportKv: WorkerExportKv | null = null;
  public toasts: import('../types').ToastMessage[] = [];

  private listeners: Set<Listener> = new Set();

  constructor() {
    this.config = StorageService.getConfig();
    this.openPositions = StorageService.getOpenPositions();
    this.closedTrades = StorageService.getClosedTrades();
    this.signalLogs = StorageService.getSignalLogs();
    this.cursor = StorageService.getCursor();
    this.isLocalHalted = StorageService.getLocalHalt();
  }

  public addToast(type: 'buy' | 'tp' | 'sl' | 'info' | 'warn', title: string, message: string) {
    const toast: import('../types').ToastMessage = {
      id: `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type,
      title,
      message,
      timestamp: Date.now(),
    };
    this.toasts = [toast, ...this.toasts].slice(0, 4);
    this.notify();

    setTimeout(() => {
      this.dismissToast(toast.id);
    }, 4500);
  }

  public dismissToast(id: string) {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.notify();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  public getConfig(): AppConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<AppConfig>) {
    this.config = { ...this.config, ...newConfig };
    StorageService.saveConfig(this.config);
    this.notify();
  }

  public getOpenPositions(): PaperPosition[] {
    return [...this.openPositions];
  }

  public getClosedTrades(): ClosedTrade[] {
    return [...this.closedTrades];
  }

  public getSignalLogs(): SignalLogItem[] {
    return [...this.signalLogs];
  }

  public getCursor(): number {
    return this.cursor;
  }

  public isScannerActive(): boolean {
    return this.isRunning;
  }

  public isLocalHaltActive(): boolean {
    return this.isLocalHalted;
  }

  public isRemoteHaltActive(): boolean {
    return this.isRemoteHalted;
  }

  /**
   * Start the Engine (Signal Polling + Price Tick + Heartbeat)
   */
  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Acquire WakeLock if supported
    this.acquireWakeLock();

    // Trigger initial heartbeat
    await this.sendHeartbeat();

    // Start poll loop
    this.scheduleNextPoll(100);

    // Start price tick loop
    this.priceTimer = setInterval(() => {
      this.tickPrices();
    }, this.config.priceIntervalMs);

    // Start heartbeat interval (every 300,000ms / 5 min)
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, 300000);

    this.notify();
  }

  /**
   * Stop the Engine
   */
  public stop() {
    this.isRunning = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.priceTimer) clearInterval(this.priceTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.releaseWakeLock();
    this.notify();
  }

  /**
   * Local Halt Toggle
   */
  public setLocalHalt(halt: boolean) {
    this.isLocalHalted = halt;
    StorageService.saveLocalHalt(halt);
    this.notify();
  }

  /**
   * Remote Worker Halt Toggle (POST /halt?on=1|0)
   */
  public async setRemoteHalt(halt: boolean) {
    const res = await WorkerApi.toggleHalt(this.config, halt);
    if (res.data) {
      this.isRemoteHalted = res.data.halt;
      this.workerStatus = 'connected';
    } else {
      this.workerStatus = 'error';
      this.workerErrorMessage = res.error || 'Failed to toggle remote halt';
    }
    this.notify();
  }

  /**
   * Refresh Worker State Snapshot (GET /export-kv)
   */
  public async refreshWorkerKv(): Promise<WorkerExportKv | null> {
    const res = await WorkerApi.exportKv(this.config);
    this.lastWorkerLatencyMs = res.latencyMs;
    if (res.data) {
      this.latestExportKv = res.data;
      this.isRemoteHalted = !!res.data.queue?.halt;
      if (res.data.queue?.seq && res.data.queue.seq > this.cursor) {
        // align cursor if needed
      }
      this.workerStatus = 'connected';
      this.workerErrorMessage = '';
      this.notify();
      return res.data;
    } else {
      this.workerStatus = 'error';
      this.workerErrorMessage = res.error || 'Worker unreachable';
      this.notify();
      return null;
    }
  }

  /**
   * Signal Poll Loop
   */
  private scheduleNextPoll(delayMs?: number) {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollSignals();
      } catch (e) {
        console.error('Error in pollSignals loop', e);
      }
      if (this.isRunning) {
        this.scheduleNextPoll(this.config.pollIntervalMs);
      }
    }, delayMs ?? this.config.pollIntervalMs);
  }

  private async pollSignals() {
    this.lastPollAt = Date.now();
    const res = await WorkerApi.getSignals(this.config, this.cursor);
    this.lastWorkerLatencyMs = res.latencyMs;

    if (!res.data) {
      this.workerStatus = 'error';
      this.workerErrorMessage = res.error || 'Signal poll error';
      this.notify();
      return;
    }

    this.workerStatus = 'connected';
    this.workerErrorMessage = '';
    const { signals, seq, oldestId, halt } = res.data;
    this.isRemoteHalted = halt;

    // Detect sequence gaps
    if (oldestId > this.cursor + 1 && this.cursor > 0) {
      this.sequenceGapDetected = true;
    } else {
      this.sequenceGapDetected = false;
    }

    if (seq > this.cursor) {
      this.cursor = seq;
      StorageService.saveCursor(this.cursor);
    }

    if (signals && signals.length > 0) {
      for (const sig of signals) {
        await this.processSignal(sig);
      }
    }

    this.notify();
  }

  /**
   * Process an individual signal through the safety pipeline
   */
  public async processSignal(signal: WorkerSignal): Promise<SignalLogItem> {
    const now = Date.now();
    const latencyMs = now - signal.ts;
    const MAX_SIGNAL_AGE_MS = 60000; // 60s max signal age

    const logItem: SignalLogItem = {
      id: `sig_${signal.id}_${now}`,
      signalId: signal.id,
      mint: signal.mint,
      sig: signal.sig,
      receivedAt: now,
      signalTs: signal.ts,
      latencyMs,
      status: 'skipped',
    };

    // Check 1: Stale signal check (> 60s)
    if (now - signal.ts > MAX_SIGNAL_AGE_MS) {
      logItem.skipReason = 'stale_signal';
      this.recordSignalLog(logItem);
      return logItem;
    }

    // Check 2: Local or Remote Halt
    if (this.isLocalHalted) {
      logItem.skipReason = 'local_halt';
      this.recordSignalLog(logItem);
      return logItem;
    }
    if (this.isRemoteHalted) {
      logItem.skipReason = 'remote_halt';
      this.recordSignalLog(logItem);
      return logItem;
    }

    // Check 3: Position already open for this mint
    if (this.openPositions.some(p => p.mint === signal.mint)) {
      logItem.skipReason = 'position_already_open';
      this.recordSignalLog(logItem);
      return logItem;
    }

    // Check 4: Max open positions gate
    if (this.openPositions.length >= this.config.maxOpen) {
      logItem.skipReason = 'skip_maxopen';
      this.recordSignalLog(logItem);
      return logItem;
    }

    // Check 5: On-Chain Safety Gate
    const gateVerdict = await SolanaRpc.runOnChainGate(this.config, signal.mint);
    logItem.gateVerdict = gateVerdict;

    if (!gateVerdict.passed) {
      logItem.status = 'rejected';
      logItem.skipReason = 'gate_rejected';
      logItem.rejectionReasons = gateVerdict.reasons;
      this.recordSignalLog(logItem);
      return logItem;
    }

    // Check 6: DexScreener Quote & Liquidity Gate
    const quote = await DexScreenerService.getQuote(signal.mint);
    logItem.quote = quote || undefined;

    if (!quote || quote.liqUsd < this.config.minLiqUsd) {
      logItem.status = 'rejected';
      logItem.skipReason = 'skip_liquidity';
      logItem.rejectionReasons = [
        quote
          ? `Liquidity $${Math.round(quote.liqUsd).toLocaleString()} is below minimum required $${this.config.minLiqUsd.toLocaleString()}`
          : 'No valid Solana DexScreener quote pair found',
      ];
      this.recordSignalLog(logItem);
      return logItem;
    }

    // ALL GATES PASSED: Enter Paper Position!
    logItem.status = 'entered';
    this.recordSignalLog(logItem);

    await this.enterPaperPosition(signal, quote);
    return logItem;
  }

  /**
   * Enter a paper trade position with pessimistic entry slippage
   */
  private async enterPaperPosition(signal: WorkerSignal, quote: any) {
    const entrySlip = this.config.entrySlip;
    const entryPriceRaw = quote.priceUsd;
    const entryPrice = entryPriceRaw * (1 + entrySlip); // +5% entry slip
    const stakeUsd = this.config.stakeUsdDefault || 100; // Configurable paper stake
    const shares = stakeUsd / entryPrice;
    const now = Date.now();

    const position: PaperPosition = {
      id: `pos_${signal.id || Date.now()}_${signal.mint.slice(0, 6)}`,
      signalId: signal.id,
      mint: signal.mint,
      symbol: quote.symbol || 'TOKEN',
      name: quote.name || 'Token',
      sig: signal.sig,
      openedAt: now,
      entryPriceRaw,
      entryPrice,
      entryLiqUsd: quote.liqUsd,
      stakeUsd,
      shares,

      currentQuotePrice: quote.priceUsd,
      currentLiqUsd: quote.liqUsd,
      executablePrice: quote.priceUsd * (1 - this.config.exitSlip),
      unrealizedPnlPct: ((quote.priceUsd * (1 - this.config.exitSlip) - entryPrice) / entryPrice) * 100,
      unrealizedPnlUsd: 0,
      peakExecutablePrice: quote.priceUsd * (1 - this.config.exitSlip),
      peakPnlPct: 0,

      tookHalf: false,
      bankedUsd: 0,
      trailingArmed: false,
      missedQuoteTicks: 0,
      isUnresolved: false,

      lastHighAt: now,
      lastTickAt: now,
      priceHistory: [entryPriceRaw],
    };

    this.openPositions.unshift(position);
    StorageService.saveOpenPositions(this.openPositions);

    if (this.config.soundAlerts) {
      sounds.playBuy();
    }

    this.addToast(
      'buy',
      `PAPER BUY: ${position.symbol}`,
      `Filled at $${entryPrice.toFixed(6)} (+5% slip)\nLiq: $${Math.round(position.entryLiqUsd).toLocaleString()}`
    );

    // Send Telegram Notification via Worker
    const notifyText = `🟢 [PAPER BUY] ${position.symbol} (${position.mint.slice(0, 6)}...)\nEntry: $${entryPrice.toFixed(6)} (+5% slip)\nLiq: $${Math.round(position.entryLiqUsd).toLocaleString()}`;
    WorkerApi.sendNotify(this.config, notifyText).catch(() => {});

    // Update Worker heartbeat with new position count
    this.sendHeartbeat();
    this.notify();
  }

  /**
   * Price Tick & Exit Rules Loop (Every 5,000 ms)
   */
  public async tickPrices() {
    if (this.openPositions.length === 0) return;

    const exitSlip = this.config.exitSlip;
    const now = Date.now();
    const positionsToKeep: PaperPosition[] = [];

    for (const pos of this.openPositions) {
      const quote = await DexScreenerService.getQuote(pos.mint);

      if (!quote) {
        pos.missedQuoteTicks += 1;
        // Never fabricate -100% loss. Mark unresolved after 12 missed ticks (~60s)
        if (pos.missedQuoteTicks >= 12) {
          pos.isUnresolved = true;
        }

        // Archive if unresolved for > 30 minutes
        if (pos.isUnresolved && now - pos.openedAt > this.config.maxHoldSec * 1000) {
          this.closePosition(pos, 'unresolved', pos.executablePrice, pos.currentLiqUsd);
          continue;
        }

        positionsToKeep.push(pos);
        continue;
      }

      // Reset missed tick counter on valid quote
      pos.missedQuoteTicks = 0;
      pos.isUnresolved = false;
      pos.currentQuotePrice = quote.priceUsd;
      pos.currentLiqUsd = quote.liqUsd;
      pos.lastTickAt = now;

      // Track price history for sparklines (up to 20 samples)
      if (!pos.priceHistory) pos.priceHistory = [];
      pos.priceHistory.push(quote.priceUsd);
      if (pos.priceHistory.length > 20) pos.priceHistory.shift();

      // Pessimistic executable exit price (-8% slip)
      const executablePrice = quote.priceUsd * (1 - exitSlip);
      pos.executablePrice = executablePrice;

      // Current unrealized PnL %
      const rawPnlPct = ((executablePrice - pos.entryPrice) / pos.entryPrice) * 100;
      pos.unrealizedPnlPct = rawPnlPct;
      pos.unrealizedPnlUsd = (pos.stakeUsd * rawPnlPct) / 100;

      // Track peak
      if (executablePrice > pos.peakExecutablePrice) {
        pos.peakExecutablePrice = executablePrice;
        pos.peakPnlPct = rawPnlPct;
        pos.lastHighAt = now;
      }

      // Rule A: Take Profit Half at >= +100%
      if (!pos.tookHalf && rawPnlPct >= this.config.takeProfitHalfPct) {
        pos.tookHalf = true;
        // Bank 50% of the position at +100%
        pos.bankedUsd = (pos.stakeUsd * 0.5) * (rawPnlPct / 100);
        if (this.config.soundAlerts) sounds.playTakeProfit();
        this.addToast(
          'tp',
          `50% TP BANKED: ${pos.symbol}`,
          `Gained +${rawPnlPct.toFixed(1)}%! Banked $${pos.bankedUsd.toFixed(2)}`
        );
        WorkerApi.sendNotify(
          this.config,
          `💰 [PAPER 50% TP BANKED] ${pos.symbol} reached +${rawPnlPct.toFixed(1)}% | Banked $${pos.bankedUsd.toFixed(2)}`
        ).catch(() => {});
      }

      // Rule B: Trailing Stop Arm at >= +50%
      if (!pos.trailingArmed && rawPnlPct >= this.config.trailingStopArmPct) {
        pos.trailingArmed = true;
        this.addToast('info', `TRAIL ARMED: ${pos.symbol}`, `Armed at +${rawPnlPct.toFixed(1)}% (will trail peak by 20%)`);
      }

      // EXIT EVALUATION:

      // Exit 1: Stop Loss (<= -25%)
      if (rawPnlPct <= this.config.stopLossPct) {
        if (this.config.soundAlerts) sounds.playStopLoss();
        this.closePosition(pos, 'stop_loss', executablePrice, quote.liqUsd);
        continue;
      }

      // Exit 2: Trailing Stop (Armed and pulled back 20% from peak executable price)
      if (pos.trailingArmed && executablePrice <= pos.peakExecutablePrice * (1 - this.config.trailingStopPullbackPct / 100)) {
        if (this.config.soundAlerts) sounds.playTakeProfit();
        this.closePosition(pos, 'trailing_stop', executablePrice, quote.liqUsd);
        continue;
      }

      // Exit 3: Liquidity Drop (liqUsd < entryLiqUsd * 0.70)
      if (quote.liqUsd < pos.entryLiqUsd * 0.70) {
        if (this.config.soundAlerts) sounds.playStopLoss();
        this.closePosition(pos, 'liquidity_drop', executablePrice, quote.liqUsd);
        continue;
      }

      // Exit 4: Max Hold (>= 30 minutes / 1800s)
      if (now - pos.openedAt >= this.config.maxHoldSec * 1000) {
        this.closePosition(pos, 'max_hold', executablePrice, quote.liqUsd);
        continue;
      }

      // Exit 5: Time Stop (stuck in [-10%, +15%] band for 180s with no new high)
      const inBand = rawPnlPct >= -10 && rawPnlPct <= 15;
      if (inBand) {
        if (!pos.enteredBandAt) pos.enteredBandAt = now;
        const timeInBand = now - Math.max(pos.enteredBandAt, pos.lastHighAt);
        if (timeInBand >= this.config.timeStopWindowSec * 1000) {
          this.closePosition(pos, 'time_stop', executablePrice, quote.liqUsd);
          continue;
        }
      } else {
        pos.enteredBandAt = undefined;
      }

      positionsToKeep.push(pos);
    }

    this.openPositions = positionsToKeep;
    StorageService.saveOpenPositions(this.openPositions);
    this.notify();
  }

  /**
   * Close a paper position and record to ClosedTrade history
   */
  public closePosition(
    pos: PaperPosition,
    exitReason: ExitReason,
    exitPriceOverride?: number,
    exitLiqOverride?: number
  ) {
    const now = Date.now();
    const holdSeconds = Math.max(1, Math.round((now - pos.openedAt) / 1000));
    const exitPrice = exitPriceOverride ?? pos.executablePrice;
    const exitPriceRaw = pos.currentQuotePrice;
    const exitLiqUsd = exitLiqOverride ?? pos.currentLiqUsd;

    // Calculate 1x Slippage PnL %
    let pnlPct1x = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
    let bankedUsd = pos.bankedUsd || 0;

    if (pos.tookHalf) {
      // 50% was already banked, remaining 50% closed at exitPrice
      const remPnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
      pnlPct1x = (pos.bankedUsd / (pos.stakeUsd * 0.5)) * 50 + remPnlPct * 0.5;
    }
    const pnlUsd1x = (pos.stakeUsd * pnlPct1x) / 100;

    // Calculate 2x Slippage Stress:
    // Entry Slip = 10% (1.10), Exit Slip = 16% (0.84)
    const entry2x = pos.entryPriceRaw * 1.10;
    const exit2x = exitPriceRaw * (1 - 0.16);
    let pnlPct2x = ((exit2x - entry2x) / entry2x) * 100;
    if (pos.tookHalf) {
      const half2x = 50 * (2.0 * 0.84 / 1.10 - 1);
      const rem2x = 50 * (exit2x / entry2x - 1);
      pnlPct2x = half2x + rem2x;
    }
    const pnlUsd2x = (pos.stakeUsd * pnlPct2x) / 100;

    const closedTrade: ClosedTrade = {
      id: `trade_${pos.id}_${now}`,
      mint: pos.mint,
      symbol: pos.symbol,
      name: pos.name,
      openedAt: pos.openedAt,
      closedAt: now,
      holdSeconds,
      entryPriceRaw: pos.entryPriceRaw,
      entryPrice: pos.entryPrice,
      exitPriceRaw,
      exitPrice,
      entryLiqUsd: pos.entryLiqUsd,
      exitLiqUsd,
      exitReason,
      tookHalf: pos.tookHalf,
      bankedUsd,
      pnlPct1x: Math.round(pnlPct1x * 100) / 100,
      pnlUsd1x: Math.round(pnlUsd1x * 100) / 100,
      pnlPct2x: Math.round(pnlPct2x * 100) / 100,
      pnlUsd2x: Math.round(pnlUsd2x * 100) / 100,
    };

    // Remove from open positions
    this.openPositions = this.openPositions.filter(p => p.id !== pos.id);
    StorageService.saveOpenPositions(this.openPositions);

    // Add to closed trades history
    this.closedTrades.unshift(closedTrade);
    StorageService.saveClosedTrades(this.closedTrades);

    // Toast alert
    const isWin = closedTrade.pnlPct1x >= 0;
    this.addToast(
      isWin ? 'tp' : 'sl',
      `PAPER EXIT: ${pos.symbol} (${exitReason})`,
      `1x PnL: ${isWin ? '+' : ''}${closedTrade.pnlPct1x.toFixed(2)}%\n2x Slip PnL: ${closedTrade.pnlPct2x >= 0 ? '+' : ''}${closedTrade.pnlPct2x.toFixed(2)}%\nHeld: ${holdSeconds}s`
    );

    // Notify Telegram via Worker
    const notifyText = `🔴 [PAPER EXIT] ${pos.symbol} (${pos.mint.slice(0, 6)}...)\nReason: ${exitReason}\n1x PnL: ${closedTrade.pnlPct1x >= 0 ? '+' : ''}${closedTrade.pnlPct1x}%\n2x Slip PnL: ${closedTrade.pnlPct2x >= 0 ? '+' : ''}${closedTrade.pnlPct2x}%\nHold: ${holdSeconds}s`;
    WorkerApi.sendNotify(this.config, notifyText).catch(() => {});

    // Update Heartbeat
    this.sendHeartbeat();
    this.notify();
  }

  /**
   * Manual Close Position Trigger
   */
  public manualClose(posId: string) {
    const pos = this.openPositions.find(p => p.id === posId);
    if (pos) {
      this.closePosition(pos, 'manual_close');
    }
  }

  /**
   * Simulate Inbound Signal (Interactive Testing)
   */
  public async simulateSignal(targetMint?: string) {
    const mints = [
      'So11111111111111111111111111111111111111112', // SOL
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
      'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
    ];
    const mint = targetMint || mints[Math.floor(Math.random() * mints.length)];
    const mockSig: WorkerSignal = {
      id: this.cursor + 1,
      mint,
      sig: `${Math.random().toString(36).substring(2, 12)}TxMockSignatureSolanaMainnet`,
      ts: Date.now(),
      chainTs: Math.floor(Date.now() / 1000),
    };

    this.cursor += 1;
    StorageService.saveCursor(this.cursor);
    this.addToast('info', 'TEST SIGNAL INJECTED', `Auditing ${mint.slice(0, 6)}... through on-chain safety gate`);
    return await this.processSignal(mockSig);
  }

  /**
   * Test Telegram Notification
   */
  public async testSendNotify(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = performance.now();
    const res = await WorkerApi.sendNotify(
      this.config,
      `🔔 [TEST NOTIFY] Solana Sniper Bot connected successfully at ${new Date().toLocaleTimeString()}!`
    );
    const latencyMs = Math.round(performance.now() - start);
    if (res.data?.ok) {
      this.addToast('buy', 'TELEGRAM RELAY OK', 'Test notification relayed successfully to Worker /notify');
      return { ok: true, latencyMs };
    }
    this.addToast('warn', 'TELEGRAM RELAY FAILED', res.error || 'Worker unreachable');
    return { ok: false, latencyMs, error: res.error };
  }

  /**
   * Heartbeat sender (every 5 min or on count change)
   */
  public async sendHeartbeat() {
    this.lastHeartbeatAt = Date.now();
    const res = await WorkerApi.sendHeartbeat(this.config, this.openPositions.length);
    if (res.data?.ok) {
      this.workerStatus = 'connected';
    }
    this.notify();
  }

  private recordSignalLog(log: SignalLogItem) {
    this.signalLogs.unshift(log);
    if (this.signalLogs.length > 200) {
      this.signalLogs = this.signalLogs.slice(0, 200);
    }
    StorageService.saveSignalLogs(this.signalLogs);
    this.notify();
  }

  /**
   * Pre-load 200 Benchmark Trades
   */
  public loadBenchmarkTrades(trades: ClosedTrade[]) {
    this.closedTrades = [...trades];
    StorageService.saveClosedTrades(this.closedTrades);
    this.notify();
  }

  /**
   * Clear All Data
   */
  public resetData() {
    this.openPositions = [];
    this.closedTrades = [];
    this.signalLogs = [];
    this.cursor = 0;
    StorageService.clearAllData();
    this.notify();
  }

  /**
   * Acquire Screen WakeLock
   */
  private async acquireWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && this.config.wakeLockEnabled) {
      try {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      } catch {}
    }
  }

  private releaseWakeLock() {
    if (this.wakeLockSentinel) {
      this.wakeLockSentinel.release().catch(() => {});
      this.wakeLockSentinel = null;
    }
  }

  /**
   * Compute Real-Time Stats, Equity Curves, and Evaluation Gate
   */
  public getStats(): EngineStats {
    const closed = this.closedTrades;
    const closedCount = closed.length;
    const wins = closed.filter(t => t.pnlPct1x > 0);
    const winCount = wins.length;
    const lossCount = closed.filter(t => t.pnlPct1x <= 0).length;
    const winRatePct = closedCount > 0 ? (winCount / closedCount) * 100 : 0;

    // 1x Slippage Metrics
    const pnl1xList = closed.map(t => t.pnlPct1x);
    const meanPnl1x = pnl1xList.length > 0 ? pnl1xList.reduce((a, b) => a + b, 0) / pnl1xList.length : 0;
    const medianPnl1x = this.calcMedian(pnl1xList);

    // 2x Slippage Metrics
    const pnl2xList = closed.map(t => t.pnlPct2x);
    const meanPnl2x = pnl2xList.length > 0 ? pnl2xList.reduce((a, b) => a + b, 0) / pnl2xList.length : 0;
    const medianPnl2x = this.calcMedian(pnl2xList);

    // Fixed-fractional 10% equity curves starting at 100 index
    let eq1x = 100;
    let eq2x = 100;
    let peakEq1x = 100;
    let peakEq2x = 100;
    let maxDd1x = 0;
    let maxDd2x = 0;

    // Replay in chronological order (oldest to newest)
    const chrono = [...closed].reverse();
    for (const trade of chrono) {
      const stake1 = eq1x * 0.10;
      eq1x += (stake1 * trade.pnlPct1x) / 100;
      if (eq1x > peakEq1x) peakEq1x = eq1x;
      const dd1 = ((peakEq1x - eq1x) / peakEq1x) * 100;
      if (dd1 > maxDd1x) maxDd1x = dd1;

      const stake2 = eq2x * 0.10;
      eq2x += (stake2 * trade.pnlPct2x) / 100;
      if (eq2x > peakEq2x) peakEq2x = eq2x;
      const dd2 = ((peakEq2x - eq2x) / peakEq2x) * 100;
      if (dd2 > maxDd2x) maxDd2x = dd2;
    }

    // Exit reason breakdown
    const exitReasonCounts: Record<ExitReason, number> = {
      stop_loss: 0,
      liquidity_drop: 0,
      max_hold: 0,
      trailing_stop: 0,
      time_stop: 0,
      unresolved: 0,
      manual_close: 0,
    };
    for (const t of closed) {
      if (exitReasonCounts[t.exitReason] !== undefined) {
        exitReasonCounts[t.exitReason]++;
      }
    }

    // Skip reason breakdown
    const skipReasonCounts: Record<SkipReason, number> = {
      stale_signal: 0,
      position_already_open: 0,
      skip_maxopen: 0,
      skip_liquidity: 0,
      local_halt: 0,
      remote_halt: 0,
      gate_rejected: 0,
    };
    for (const log of this.signalLogs) {
      if (log.skipReason && skipReasonCounts[log.skipReason] !== undefined) {
        skipReasonCounts[log.skipReason]++;
      }
    }

    const unresolvedCount = exitReasonCounts.unresolved;

    // Stressed pnl considering unresolved as -25%
    const stressedList = closed.map(t => (t.exitReason === 'unresolved' ? -25 : t.pnlPct2x));
    const stressedMeanPnl = stressedList.length > 0 ? stressedList.reduce((a, b) => a + b, 0) / stressedList.length : 0;
    const stressedMedianPnl = this.calcMedian(stressedList);

    // Evaluation Gate Condition:
    // closed >= 200 && mean1x > 0 && median1x > 0 && mean2x > 0 && median2x > 0
    const evaluationGatePassed =
      closedCount >= 200 &&
      meanPnl1x > 0 &&
      medianPnl1x > 0 &&
      meanPnl2x > 0 &&
      medianPnl2x > 0;

    return {
      openCount: this.openPositions.length,
      closedCount,
      winCount,
      lossCount,
      winRatePct,
      meanPnl1x,
      medianPnl1x,
      meanPnl2x,
      medianPnl2x,
      currentEquity1x: eq1x,
      currentEquity2x: eq2x,
      maxDrawdownPct1x: maxDd1x,
      maxDrawdownPct2x: maxDd2x,
      stressedMeanPnl,
      stressedMedianPnl,
      unresolvedCount,
      exitReasonCounts,
      skipReasonCounts,
      evaluationGatePassed,
    };
  }

  public getEquityCurvePoints(): EquityPoint[] {
    const closed = [...this.closedTrades].reverse();
    const points: EquityPoint[] = [{
      tradeIndex: 0,
      equity1x: 100,
      equity2x: 100,
      drawdown1x: 0,
      drawdown2x: 0,
      timestamp: closed.length > 0 ? closed[0].openedAt : Date.now(),
    }];

    let eq1 = 100;
    let eq2 = 100;
    let peak1 = 100;
    let peak2 = 100;

    for (let i = 0; i < closed.length; i++) {
      const trade = closed[i];
      eq1 += (eq1 * 0.10 * trade.pnlPct1x) / 100;
      eq2 += (eq2 * 0.10 * trade.pnlPct2x) / 100;

      if (eq1 > peak1) peak1 = eq1;
      if (eq2 > peak2) peak2 = eq2;

      const dd1 = ((peak1 - eq1) / peak1) * 100;
      const dd2 = ((peak2 - eq2) / peak2) * 100;

      points.push({
        tradeIndex: i + 1,
        equity1x: Math.round(eq1 * 100) / 100,
        equity2x: Math.round(eq2 * 100) / 100,
        drawdown1x: Math.round(dd1 * 10) / 10,
        drawdown2x: Math.round(dd2 * 10) / 10,
        timestamp: trade.closedAt,
      });
    }

    return points;
  }

  private calcMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }
}

export const engine = new SniperEngine();
