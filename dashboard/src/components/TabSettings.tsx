/**
 * Tab 5: Connection Settings & Diagnostics
 * Encrypted/Safe local storage configuration with key masking,
 * full tunable risk & algorithmic parameters, 3-point diagnostic test suite,
 * Telegram relay tester, audio chime test panel, and Android wake-lock settings.
 */

import React, { useState } from 'react';
import {
  Settings,
  Shield,
  Eye,
  EyeOff,
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Sliders,
  Volume2,
  VolumeX,
  Smartphone,
  Check,
  Zap,
  Send,
  Heart,
  Music,
} from 'lucide-react';
import { engine, sounds } from '../services/engine';
import { WorkerApi } from '../services/workerApi';
import { SolanaRpc } from '../services/solanaRpc';
import { DexScreenerService } from '../services/dexScreener';
import { DEFAULT_CONFIG, maskSecret } from '../services/storage';
import { AppConfig } from '../types';

interface DiagResult {
  step: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export const TabSettings: React.FC = () => {
  const currentConfig = engine.getConfig();
  const [form, setForm] = useState<AppConfig>({ ...currentConfig });
  const [showAppKey, setShowAppKey] = useState(false);
  const [showRpcUrl, setShowRpcUrl] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Diagnostics state
  const [isTestingDiag, setIsTestingDiag] = useState(false);
  const [diagResults, setDiagResults] = useState<DiagResult[] | null>(null);
  const [isTestingNotify, setIsTestingNotify] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    engine.updateConfig(form);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleResetDefaults = () => {
    if (confirm('Reset connection and risk parameters to defaults?')) {
      setForm({ ...DEFAULT_CONFIG });
      engine.updateConfig(DEFAULT_CONFIG);
    }
  };

  const runEndToEndDiagnostics = async () => {
    setIsTestingDiag(true);
    setDiagResults(null);
    const results: DiagResult[] = [];

    // Test 1: Worker GET /export-kv (Verifies APP_KEY & Cloudflare Durable Object)
    try {
      const workerRes = await WorkerApi.exportKv(form);
      if (workerRes.data) {
        results.push({
          step: '1. Cloudflare Worker (SignalQueueDO)',
          ok: true,
          latencyMs: workerRes.latencyMs,
          detail: `Connected. DO Sequence: ${workerRes.data.queue?.seq ?? 0}, Halt: ${workerRes.data.queue?.halt ? 'YES' : 'NO'}, Heartbeat Open: ${workerRes.data.hb?.open ?? 0}`,
        });
      } else {
        results.push({
          step: '1. Cloudflare Worker (SignalQueueDO)',
          ok: false,
          latencyMs: workerRes.latencyMs,
          detail: `Worker error: ${workerRes.error || 'Connection refused or invalid x-key'}`,
        });
      }
    } catch (err: any) {
      results.push({
        step: '1. Cloudflare Worker (SignalQueueDO)',
        ok: false,
        latencyMs: 0,
        detail: `Worker connection exception: ${err.message}`,
      });
    }

    // Test 2: Solana JSON-RPC getSlot / getHealth
    try {
      const rpcRes = await SolanaRpc.checkHealth(form.rpcUrl);
      if (rpcRes.ok) {
        results.push({
          step: '2. Solana JSON-RPC Endpoint',
          ok: true,
          latencyMs: rpcRes.latencyMs,
          detail: `Operational. Current Slot: ${rpcRes.slot?.toLocaleString()}`,
        });
      } else {
        results.push({
          step: '2. Solana JSON-RPC Endpoint',
          ok: false,
          latencyMs: rpcRes.latencyMs,
          detail: `RPC error: ${rpcRes.error || 'Failed to query Solana RPC'}`,
        });
      }
    } catch (err: any) {
      results.push({
        step: '2. Solana JSON-RPC Endpoint',
        ok: false,
        latencyMs: 0,
        detail: `RPC error: ${err.message}`,
      });
    }

    // Test 3: DexScreener Public API Token Quote
    try {
      const dexRes = await DexScreenerService.testConnection();
      if (dexRes.ok) {
        results.push({
          step: '3. DexScreener Public Quote API',
          ok: true,
          latencyMs: dexRes.latencyMs,
          detail: 'Operational. Live quotes streaming freely.',
        });
      } else {
        results.push({
          step: '3. DexScreener Public Quote API',
          ok: false,
          latencyMs: dexRes.latencyMs,
          detail: `DexScreener error: ${dexRes.error || 'API unreachable'}`,
        });
      }
    } catch (err: any) {
      results.push({
        step: '3. DexScreener Public Quote API',
        ok: false,
        latencyMs: 0,
        detail: `DexScreener error: ${err.message}`,
      });
    }

    setDiagResults(results);
    setIsTestingDiag(false);
  };

  const handleTestNotify = async () => {
    setIsTestingNotify(true);
    await engine.testSendNotify();
    setIsTestingNotify(false);
  };

  const handleTestHeartbeat = async () => {
    await engine.sendHeartbeat();
    engine.addToast('info', 'HEARTBEAT SENT', `Sent open count (${engine.getOpenPositions().length}) to Worker`);
  };

  return (
    <div className="space-y-4 pb-20 font-mono text-xs">
      
      {/* Diagnostics Test Card */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <div className="font-bold text-sm text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <span>3-Point End-to-End Diagnostics & Relays</span>
            </div>
            <div className="text-[11px] text-zinc-400">
              Validates Cloudflare Worker DO, Solana JSON-RPC, and DexScreener Quote Feed
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={runEndToEndDiagnostics}
              disabled={isTestingDiag}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs transition-colors cursor-pointer"
            >
              {isTestingDiag ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Auditing...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Run 3-Point Diagnostic</span>
                </>
              )}
            </button>

            <button
              onClick={handleTestNotify}
              disabled={isTestingNotify}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 cursor-pointer text-xs"
              title="Send test message to Telegram via Worker /notify"
            >
              <Send className="w-3.5 h-3.5 text-emerald-400" />
              <span>Test Telegram Notify</span>
            </button>

            <button
              onClick={handleTestHeartbeat}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 cursor-pointer text-xs"
              title="Ping Worker /heartbeat"
            >
              <Heart className="w-3.5 h-3.5 text-red-400" />
              <span>Test Heartbeat</span>
            </button>
          </div>
        </div>

        {diagResults && (
          <div className="space-y-2 mt-3 pt-3 border-t border-zinc-800">
            {diagResults.map((res, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800"
              >
                {res.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-200">{res.step}</span>
                    <span className="text-[10px] text-zinc-500">{res.latencyMs}ms</span>
                  </div>
                  <div className={`text-[11px] mt-0.5 ${res.ok ? 'text-zinc-400' : 'text-red-400'}`}>
                    {res.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="space-y-4">
        
        {/* Section 1: Backend & API Endpoints */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-3">
          <div className="font-bold text-sm text-white flex items-center gap-2 border-b border-zinc-800 pb-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <span>Connection Endpoints & Secrets</span>
          </div>

          {/* Worker URL */}
          <div>
            <label className="block text-zinc-400 text-xs mb-1">
              WORKER_URL (Cloudflare Worker SignalQueueDO)
            </label>
            <input
              type="text"
              value={form.workerUrl}
              onChange={e => setForm({ ...form, workerUrl: e.target.value })}
              placeholder="https://sniper-relay.pjdebnath01.workers.dev"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
            />
            <div className="text-[10px] text-zinc-500 mt-1">
              Durable Object ring buffer endpoint (`/signals`, `/export-kv`, `/halt`, `/heartbeat`, `/notify`).
            </div>
          </div>

          {/* APP_KEY Secret */}
          <div>
            <label className="block text-zinc-400 text-xs mb-1">
              APP_KEY (Sent in `x-key: &lt;APP_KEY&gt;` header)
            </label>
            <div className="relative">
              <input
                type={showAppKey ? 'text' : 'password'}
                value={form.appKey}
                onChange={e => setForm({ ...form, appKey: e.target.value })}
                placeholder="Enter secret x-key authorized by your Cloudflare Worker"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 pr-10 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowAppKey(!showAppKey)}
                className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                {showAppKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Stored safely in local device storage. Never exposed or logged in UI error messages.
            </div>
          </div>

          {/* RPC_URL */}
          <div>
            <label className="block text-zinc-400 text-xs mb-1">
              Solana JSON-RPC Endpoint (Helius / QuickNode / Mainnet)
            </label>
            <div className="relative">
              <input
                type={showRpcUrl ? 'text' : 'password'}
                value={form.rpcUrl}
                onChange={e => setForm({ ...form, rpcUrl: e.target.value })}
                placeholder="https://mainnet.helius-rpc.com/?api-key=..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 pr-10 text-white text-xs focus:outline-none focus:border-emerald-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowRpcUrl(!showRpcUrl)}
                className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                {showRpcUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Used for read-only on-chain safety gates (`getAccountInfo`, `getTokenSupply`, `getTokenLargestAccounts`).
            </div>
          </div>
        </div>

        {/* Section 2: Tunable Algorithmic & Risk Parameters */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-3">
          <div className="font-bold text-sm text-white flex items-center gap-2 border-b border-zinc-800 pb-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <span>Tunable Risk, Slippage & Paper Exit Rules</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                Paper Stake per Trade ($ USD)
              </label>
              <input
                type="number"
                min="10"
                step="10"
                value={form.stakeUsdDefault}
                onChange={e => setForm({ ...form, stakeUsdDefault: parseInt(e.target.value, 10) || 100 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: $100</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                MAX_OPEN (Concurrent Positions)
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={form.maxOpen}
                onChange={e => setForm({ ...form, maxOpen: parseInt(e.target.value, 10) || 5 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 5</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                MIN_LIQ_USD (DexScreener Minimum)
              </label>
              <input
                type="number"
                min="1000"
                step="1000"
                value={form.minLiqUsd}
                onChange={e => setForm({ ...form, minLiqUsd: parseInt(e.target.value, 10) || 15000 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: $15,000</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                MAX_TOP10_PCT (Holder Concentration)
              </label>
              <input
                type="number"
                min="5"
                max="90"
                value={form.maxTop10Pct}
                onChange={e => setForm({ ...form, maxTop10Pct: parseInt(e.target.value, 10) || 35 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 35% (excludes AMM vaults)</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                STOP_LOSS_PCT (Exit Trigger)
              </label>
              <input
                type="number"
                min="-50"
                max="-5"
                value={form.stopLossPct}
                onChange={e => setForm({ ...form, stopLossPct: parseInt(e.target.value, 10) || -25 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: -25%</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                TAKE_PROFIT_HALF_PCT (Bank 50%)
              </label>
              <input
                type="number"
                min="20"
                max="500"
                value={form.takeProfitHalfPct}
                onChange={e => setForm({ ...form, takeProfitHalfPct: parseInt(e.target.value, 10) || 100 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: +100%</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                TRAILING_ARM_PCT (Arm Trailing)
              </label>
              <input
                type="number"
                min="10"
                max="300"
                value={form.trailingStopArmPct}
                onChange={e => setForm({ ...form, trailingStopArmPct: parseInt(e.target.value, 10) || 50 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: +50%</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                TRAILING_PULLBACK_PCT (Peak Drop)
              </label>
              <input
                type="number"
                min="5"
                max="50"
                value={form.trailingStopPullbackPct}
                onChange={e => setForm({ ...form, trailingStopPullbackPct: parseInt(e.target.value, 10) || 20 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 20% pullback</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                TIME_STOP_WINDOW_SEC
              </label>
              <input
                type="number"
                min="30"
                max="600"
                value={form.timeStopWindowSec}
                onChange={e => setForm({ ...form, timeStopWindowSec: parseInt(e.target.value, 10) || 180 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 180s (in [-10%, +15%] band)</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                MAX_HOLD_SEC
              </label>
              <input
                type="number"
                min="300"
                max="7200"
                value={form.maxHoldSec}
                onChange={e => setForm({ ...form, maxHoldSec: parseInt(e.target.value, 10) || 1800 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 1800s (30m)</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                ENTRY_SLIP (Pessimistic Buy Slip)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="0.20"
                value={form.entrySlip}
                onChange={e => setForm({ ...form, entrySlip: parseFloat(e.target.value) || 0.05 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 0.05 (+5%)</span>
            </div>

            <div>
              <label className="block text-zinc-400 text-xs mb-1">
                EXIT_SLIP (Pessimistic Sell Slip)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="0.25"
                value={form.exitSlip}
                onChange={e => setForm({ ...form, exitSlip: parseFloat(e.target.value) || 0.08 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs font-mono"
              />
              <span className="text-[10px] text-zinc-500">Default: 0.08 (-8%)</span>
            </div>
          </div>
        </div>

        {/* Section 3: Android Device & Sound Chime Panel */}
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 space-y-3">
          <div className="font-bold text-sm text-white flex items-center gap-2 border-b border-zinc-800 pb-2">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <span>Mobile Device, Wake-Lock & Audio Synthesizer</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <div>
                <div className="text-white font-medium">Sound Chimes & Alerts</div>
                <div className="text-[10px] text-zinc-500">Web Audio synthesis on fills, stops, and take profits</div>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, soundAlerts: !form.soundAlerts })}
                className={`p-2 rounded-lg transition-colors cursor-pointer ${
                  form.soundAlerts ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {form.soundAlerts ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
              <div>
                <div className="text-white font-medium">Screen Wake-Lock</div>
                <div className="text-[10px] text-zinc-500">Prevents phone screen from dimming/sleeping during scan</div>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, wakeLockEnabled: !form.wakeLockEnabled })}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  form.wakeLockEnabled ? 'bg-emerald-500 text-black' : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {form.wakeLockEnabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>
          </div>

          {/* Audio Chime Test Buttons */}
          <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-zinc-500 flex items-center gap-1">
              <Music className="w-3.5 h-3.5" /> Test Audio Chimes:
            </span>
            <button
              type="button"
              onClick={() => sounds.playBuy()}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-zinc-700 cursor-pointer"
            >
              Fill Beep (Buy)
            </button>
            <button
              type="button"
              onClick={() => sounds.playTakeProfit()}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-purple-400 border border-zinc-700 cursor-pointer"
            >
              Take Profit Chime
            </button>
            <button
              type="button"
              onClick={() => sounds.playStopLoss()}
              className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-red-400 border border-zinc-700 cursor-pointer"
            >
              Stop Loss Alert
            </button>
          </div>
        </div>

        {/* Save & Reset Actions */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors cursor-pointer"
          >
            Reset Defaults
          </button>

          <button
            type="submit"
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors cursor-pointer shadow-lg shadow-emerald-500/20"
          >
            {isSaved ? (
              <>
                <Check className="w-4 h-4" />
                <span>Saved to Secure Storage!</span>
              </>
            ) : (
              <span>Save Settings</span>
            )}
          </button>
        </div>

      </form>

    </div>
  );
};
