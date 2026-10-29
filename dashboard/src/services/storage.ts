/**
 * Secure Local Storage Manager
 * Stores WORKER_URL, APP_KEY, RPC_URL, positions, trades, and logs locally.
 * Enforces key masking and clean data integrity.
 */

import type { AppConfig, ClosedTrade, PaperPosition, SignalLogItem } from '../types/index.ts';

const STORAGE_KEYS = {
  CONFIG: 'sniper_app_config_v1',
  OPEN_POSITIONS: 'sniper_open_positions_v1',
  CLOSED_TRADES: 'sniper_closed_trades_v1',
  SIGNAL_LOGS: 'sniper_signal_logs_v1',
  CURSOR: 'sniper_seq_cursor_v1',
  LOCAL_HALT: 'sniper_local_halt_v1',
};

export const DEFAULT_CONFIG: AppConfig = {
  workerUrl: typeof window !== 'undefined' ? window.location.origin : 'https://sniper-relay.pjdebnath01.workers.dev',
  appKey: '2ab53c05f92efaadb9dc163d5a05a589769bcffda2780ed1a6d59ac9a0939618',
  rpcUrl: 'https://solana-rpc.publicnode.com',
  pollIntervalMs: 3000,
  priceIntervalMs: 5000,
  maxOpen: 5,
  minLiqUsd: 15000,
  maxTop10Pct: 35,
  entrySlip: 0.05,
  exitSlip: 0.08,
  stopLossPct: -25,
  takeProfitHalfPct: 100,
  trailingStopArmPct: 50,
  trailingStopPullbackPct: 20,
  timeStopWindowSec: 180,
  maxHoldSec: 1800,
  stakeUsdDefault: 100,
  soundAlerts: true,
  wakeLockEnabled: true,
  tgToken: '',
  tgChat: '',
};

export function maskSecret(secret?: string, visibleChars = 4): string {
  if (!secret) return 'Not Configured';
  if (secret.length <= visibleChars * 2) return '••••••••';
  const start = secret.slice(0, visibleChars);
  const end = secret.slice(-visibleChars);
  return `${start}••••${end}`;
}

export function maskUrl(url?: string): string {
  if (!url) return 'Not Configured';
  try {
    const parsed = new URL(url);
    if (parsed.search) {
      // Mask any query params (like ?api-key=...)
      return `${parsed.origin}${parsed.pathname}?api-key=••••`;
    }
    return url;
  } catch {
    return '••••••••';
  }
}

export const StorageService = {
  getConfig(): AppConfig {
    try {
      const bridge = typeof window !== 'undefined' ? (window as any).AndroidBridge : null;
      const bridgeRaw = bridge && typeof bridge.loadConfig === 'function' ? bridge.loadConfig() : '';
      const raw = bridgeRaw || localStorage.getItem(STORAGE_KEYS.CONFIG);
      const parsed = raw ? JSON.parse(raw) : {};

      const isBrowser = typeof window !== 'undefined';
      const autoWorker =
        isBrowser && window.location.origin && window.location.origin.startsWith('http')
          ? window.location.origin
          : 'https://sniper-relay.pjdebnath01.workers.dev';

      const config: AppConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
      };

      if (!config.workerUrl) {
        config.workerUrl = autoWorker;
      }
      if (!config.appKey) {
        config.appKey = '2ab53c05f92efaadb9dc163d5a05a589769bcffda2780ed1a6d59ac9a0939618';
      }
      if (
        !config.rpcUrl ||
        config.rpcUrl.includes('api.mainnet-beta.solana.com') ||
        config.rpcUrl.includes('ab2f55ad-885a-44dc-8084-651a6530b26c')
      ) {
        config.rpcUrl = 'https://solana-rpc.publicnode.com';
      }
      return config;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  },

  saveConfig(config: AppConfig): void {
    try {
      const serialized = JSON.stringify(config);
      localStorage.setItem(STORAGE_KEYS.CONFIG, serialized);
      const bridge = typeof window !== 'undefined' ? (window as any).AndroidBridge : null;
      if (bridge && typeof bridge.saveConfig === 'function') {
        bridge.saveConfig(serialized);
      }
    } catch (e) {
      console.error('Failed to save config to local storage', e);
    }
  },

  getOpenPositions(): PaperPosition[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.OPEN_POSITIONS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveOpenPositions(positions: PaperPosition[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.OPEN_POSITIONS, JSON.stringify(positions));
    } catch (e) {
      console.error('Failed to save open positions', e);
    }
  },

  getClosedTrades(): ClosedTrade[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CLOSED_TRADES);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveClosedTrades(trades: ClosedTrade[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CLOSED_TRADES, JSON.stringify(trades));
    } catch (e) {
      console.error('Failed to save closed trades', e);
    }
  },

  getSignalLogs(): SignalLogItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SIGNAL_LOGS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveSignalLogs(logs: SignalLogItem[]): void {
    try {
      // Keep up to 200 recent signal logs
      const trimmed = logs.slice(0, 200);
      localStorage.setItem(STORAGE_KEYS.SIGNAL_LOGS, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to save signal logs', e);
    }
  },

  getCursor(): number {
    try {
      const val = localStorage.getItem(STORAGE_KEYS.CURSOR);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  },

  saveCursor(cursor: number): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CURSOR, cursor.toString());
    } catch (e) {
      console.error('Failed to save cursor', e);
    }
  },

  getLocalHalt(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEYS.LOCAL_HALT) === 'true';
    } catch {
      return false;
    }
  },

  saveLocalHalt(halt: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEYS.LOCAL_HALT, halt ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to save local halt', e);
    }
  },

  clearAllData(): void {
    localStorage.removeItem(STORAGE_KEYS.OPEN_POSITIONS);
    localStorage.removeItem(STORAGE_KEYS.CLOSED_TRADES);
    localStorage.removeItem(STORAGE_KEYS.SIGNAL_LOGS);
    localStorage.removeItem(STORAGE_KEYS.CURSOR);
  },

  exportPaperJsonl(trades: ClosedTrade[]): string {
    return trades
      .filter(t => !t.simulated)
      .map(t =>
        JSON.stringify({
          ev: 'paper_close',
          pnl: t.pnlPct1x,
          pnl2xSlip: t.pnlPct2x,
          heldSec: t.holdSeconds,
          reason: t.exitReason,
          ...t,
        })
      )
      .join('\n');
  },

  exportPositionsJson(positions: PaperPosition[]): string {
    return JSON.stringify(positions.filter(p => !p.simulated), null, 2);
  },

  importPaperJsonl(jsonlText: string): ClosedTrade[] {
    const lines = jsonlText.split('\n').filter(l => l.trim().length > 0);
    const parsed: ClosedTrade[] = [];
    const now = Date.now();
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (!item || !item.mint) continue;
        if (typeof item.pnlPct1x === 'number') {
          parsed.push(item);
        } else if (item.ev === 'paper_close' && typeof item.pnl === 'number') {
          parsed.push({
            id: `imported_${item.mint}_${item.time || now}_${Math.random().toString(36).substring(2, 7)}`,
            mint: item.mint,
            symbol: item.symbol || 'IMPORTED',
            name: item.name || 'Imported Token',
            openedAt: item.openTime ? new Date(item.openTime).getTime() : now - (item.heldSec || 0) * 1000,
            closedAt: item.time ? new Date(item.time).getTime() : now,
            holdSeconds: item.heldSec || 0,
            entryPriceRaw: item.entryQuote || item.entry || 0,
            entryPrice: item.entry || 0,
            exitPriceRaw: item.exitQuote || 0,
            exitPrice: item.exit || 0,
            entryLiqUsd: item.liqUsd || 0,
            exitLiqUsd: item.exitLiqUsd || item.liqUsd || 0,
            exitReason: item.reason || 'manual_close',
            tookHalf: Boolean(item.tookHalf),
            bankedUsd: item.realizedBankedPct ? (100 * item.realizedBankedPct) / 100 : 0,
            pnlPct1x: item.pnl,
            pnlUsd1x: item.pnl,
            pnlPct2x: typeof item.pnl2xSlip === 'number' ? item.pnl2xSlip : item.pnl,
            pnlUsd2x: typeof item.pnl2xSlip === 'number' ? item.pnl2xSlip : item.pnl,
          });
        }
      } catch (err) {
        console.warn('Skipping invalid JSON line', err);
      }
    }
    return parsed;
  }
};
