/**
 * Top App Bar
 * Permanent PAPER MODE ONLY badge, Worker status, Sequence cursor, Heartbeat,
 * Quick Audio Mute, Signal Simulator, and Local/Remote Halt Kill-Switches.
 */

import React from 'react';
import {
  ShieldAlert,
  Radio,
  Power,
  Zap,
  Activity,
  Smartphone,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { engine } from '../services/engine';

interface TopBarProps {
  isMobilePreview: boolean;
  onToggleMobilePreview: () => void;
  onOpenApkModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  isMobilePreview,
  onToggleMobilePreview,
  onOpenApkModal,
}) => {
  const isScannerActive = engine.isScannerActive();
  const isLocalHalted = engine.isLocalHaltActive();
  const isRemoteHalted = engine.isRemoteHaltActive();
  const cursor = engine.getCursor();
  const workerStatus = engine.workerStatus;
  const latency = engine.lastWorkerLatencyMs;
  const lastHeartbeat = engine.lastHeartbeatAt;
  const config = engine.getConfig();

  const anyHalt = isLocalHalted || isRemoteHalted;

  const handleToggleLocalHalt = () => {
    engine.setLocalHalt(!isLocalHalted);
  };

  const handleToggleRemoteHalt = async () => {
    await engine.setRemoteHalt(!isRemoteHalted);
  };

  const handleToggleScanner = () => {
    if (isScannerActive) {
      engine.stop();
    } else {
      engine.start();
    }
  };

  const handleToggleSound = () => {
    engine.updateConfig({ soundAlerts: !config.soundAlerts });
  };

  const handleQuickSimulate = () => {
    engine.simulateSignal();
  };

  return (
    <header className="sticky top-0 z-40 bg-[#0B0F17]/95 backdrop-blur border-b border-[#1F2937] px-3 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2.5">
        
        {/* Left: Branding & Mandatory Paper Badge */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Zap className="w-4 h-4 fill-emerald-400/20" />
              {isScannerActive && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-wide text-white">SOLANA SNIPER</span>
                <span className="text-[10px] font-mono text-zinc-400">v1.0.4</span>
              </div>
              <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                <span>SignalQueueDO</span>
                <span>•</span>
                <span>Shadow Mode</span>
              </div>
            </div>
          </div>

          {/* MANDATORY SAFETY BOUNDARY: Permanent PAPER MODE ONLY Badge */}
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/40 px-2.5 py-1 rounded text-amber-300 font-mono text-xs font-bold tracking-wider animate-pulse">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>PAPER MODE ONLY</span>
          </div>

          {/* Remote & Local Halt Indicator */}
          {anyHalt && (
            <div className="flex items-center gap-1 bg-red-500/20 border border-red-500/50 px-2 py-0.5 rounded text-red-300 font-mono text-xs font-bold">
              <Power className="w-3 h-3 text-red-400" />
              <span>{isLocalHalted && isRemoteHalted ? 'ALL HALTS ACTIVE' : isLocalHalted ? 'LOCAL HALTED' : 'REMOTE HALTED'}</span>
            </div>
          )}
        </div>

        {/* Center/Right: Worker Status, Heartbeat, Seq & Kill Switches */}
        <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
          
          {/* Worker Connection Status */}
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded border ${
              workerStatus === 'connected'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : workerStatus === 'error'
                ? 'bg-red-950/40 border-red-800/60 text-red-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
            }`}
            title={engine.workerErrorMessage || 'Worker Status'}
          >
            <Radio className={`w-3 h-3 ${workerStatus === 'connected' ? 'animate-pulse text-emerald-400' : 'text-zinc-500'}`} />
            <span>DO Relay</span>
            {latency > 0 && <span className="text-[10px] opacity-80">{latency}ms</span>}
          </div>

          {/* Sequence Cursor */}
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            <span className="text-zinc-500">seq:</span>
            <span className="font-semibold text-emerald-400">{cursor}</span>
            {engine.sequenceGapDetected && (
              <span className="text-red-400 text-[10px]" title="Sequence gap detected! Missing signals">⚠️ GAP</span>
            )}
          </div>

          {/* Heartbeat Status */}
          <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[11px]">
            <Clock className="w-3 h-3 text-zinc-500" />
            <span>HB:</span>
            <span>{lastHeartbeat > 0 ? `${Math.round((Date.now() - lastHeartbeat) / 1000)}s ago` : 'pending'}</span>
          </div>

          {/* Sound Toggle */}
          <button
            onClick={handleToggleSound}
            className={`p-1.5 rounded transition-colors cursor-pointer ${
              config.soundAlerts
                ? 'bg-zinc-800 text-emerald-400 border border-zinc-700'
                : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
            }`}
            title={config.soundAlerts ? 'Sound Alerts On' : 'Sound Alerts Muted'}
          >
            {config.soundAlerts ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          {/* Quick Simulate Signal Button */}
          <button
            onClick={handleQuickSimulate}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-emerald-400 transition-colors cursor-pointer"
            title="Inject a mock signal into the pipeline"
          >
            <Zap className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">Sim</span>
          </button>

          {/* KILL-SWITCH TOGGLES */}
          <div className="flex items-center gap-1 ml-auto">
            {/* Local Kill Switch */}
            <button
              onClick={handleToggleLocalHalt}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
                isLocalHalted
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
              }`}
              title="Toggle client-side emergency halt (stops entering new signals)"
            >
              <Power className="w-3 h-3" />
              <span>{isLocalHalted ? 'LOCAL RESUME' : 'LOCAL HALT'}</span>
            </button>

            {/* Remote Cloudflare Worker Kill Switch */}
            <button
              onClick={handleToggleRemoteHalt}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
                isRemoteHalted
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
              }`}
              title="Toggle remote Worker Durable Object halt switch (POST /halt?on=1|0)"
            >
              <Activity className="w-3 h-3" />
              <span>{isRemoteHalted ? 'DO RESUME' : 'DO HALT'}</span>
            </button>

            {/* Scanner Start/Pause Master */}
            <button
              onClick={handleToggleScanner}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                isScannerActive
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
              }`}
            >
              {isScannerActive ? <Power className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
              <span>{isScannerActive ? 'SCANNING ON' : 'START SCAN'}</span>
            </button>

            {/* APK / Mobile Modal Button */}
            <button
              onClick={onOpenApkModal}
              className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-950/60 border border-indigo-700/60 text-indigo-300 hover:bg-indigo-900/60 transition-colors cursor-pointer"
              title="Android APK Build & Capacitor Packaging"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden md:inline">APK</span>
            </button>

            {/* Mobile Viewport Toggle */}
            <button
              onClick={onToggleMobilePreview}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                isMobilePreview
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'text-zinc-400 hover:text-white bg-zinc-800/80 border border-zinc-700/60'
              }`}
              title="Toggle Android Device Frame Preview"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>

      </div>
    </header>
  );
};
