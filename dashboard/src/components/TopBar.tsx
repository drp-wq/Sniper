import React, { useState } from 'react';
import { ShieldAlert, Zap, Radio, ChevronDown, Check, Activity, ShieldCheck, Power } from 'lucide-react';
import { RpcNode } from '../types';
import { haptics } from '../services/haptics';

interface TopBarProps {
  walletSol: number;
  activeRpc: RpcNode;
  allRpcNodes: RpcNode[];
  onSelectRpc: (node: RpcNode) => void;
  isEngineActive: boolean;
  onOpenKillSwitch: () => void;
  onOpenWalletModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  walletSol,
  activeRpc,
  allRpcNodes,
  onSelectRpc,
  isEngineActive,
  onOpenKillSwitch,
  onOpenWalletModal
}) => {
  const [showRpcDropdown, setShowRpcDropdown] = useState(false);

  const getLatencyBadgeClass = (latency: number) => {
    if (latency < 100) return 'text-cyan-400 bg-cyan-950/40 border-cyan-500/30';
    if (latency <= 300) return 'text-amber-400 bg-amber-950/40 border-amber-500/30';
    return 'text-red-400 bg-red-950/40 border-red-500/30';
  };

  const getLatencyDotClass = (latency: number) => {
    if (latency < 100) return 'bg-cyan-400';
    if (latency <= 300) return 'bg-amber-400';
    return 'bg-red-400';
  };

  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-white/8 backdrop-blur-xl px-3 py-2">
      <div className="flex items-center justify-between gap-1.5 sm:gap-2 max-w-7xl mx-auto">
        
        {/* Zone 1: Brand Lockup & Paper Mode Badge */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <Zap className="w-4 h-4 text-emerald-400 fill-emerald-400" />
              {isEngineActive && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs sm:text-sm font-bold tracking-tight text-white font-mono leading-none flex items-center gap-1">
                SOL<span className="text-emerald-400">RELAY</span>
              </span>
              <span className="text-[9px] text-slate-400 tracking-wider font-mono uppercase">
                Sniper OS
              </span>
            </div>
          </div>

          {/* Mandatory Paper Mode Only Safety Badge */}
          <div className="hidden xs:flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[9px] font-bold tracking-wider">
            <ShieldAlert className="w-3 h-3 text-amber-400" />
            <span>PAPER MODE</span>
          </div>
        </div>

        {/* Zone 2: Telemetry Heartbeat & Interactive Latency Gauge */}
        <div className="relative flex items-center gap-1 sm:gap-2">
          {/* Latency Trigger Button */}
          <button
            onClick={() => {
              haptics.selection();
              setShowRpcDropdown(!showRpcDropdown);
            }}
            className={`flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-md text-[10px] sm:text-[11px] font-mono border transition-all ${getLatencyBadgeClass(activeRpc.latencyMs)} active:scale-95`}
            title="Solana RPC Telemetry & Node Switcher"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${getLatencyDotClass(activeRpc.latencyMs)}`} />
            <span className="tabular-nums font-semibold">{activeRpc.latencyMs}ms</span>
            <span className="text-slate-400 hidden sm:inline">· {activeRpc.name.split(' ')[0]}</span>
            <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
          </button>

          {/* RPC Selector Dropdown */}
          {showRpcDropdown && (
            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-64 glass-panel-elevated rounded-xl p-2 shadow-2xl z-50 border border-white/10 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2 py-1 border-b border-white/5 mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Solana Cluster Endpoints
                </span>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                  <Activity className="w-3 h-3 animate-pulse" /> Live
                </span>
              </div>
              <div className="space-y-1">
                {allRpcNodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => {
                      haptics.medium();
                      onSelectRpc(node);
                      setShowRpcDropdown(false);
                    }}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-all ${
                      activeRpc.id === node.id
                        ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                        : 'hover:bg-white/5 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        {node.name}
                        {node.jitoMevSupported && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-purple-900/60 text-purple-300 font-mono">
                            MEV
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {node.location}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      <span className={node.latencyMs < 100 ? 'text-cyan-400' : node.latencyMs <= 300 ? 'text-amber-400' : 'text-red-400'}>
                        {node.latencyMs}ms
                      </span>
                      {activeRpc.id === node.id && (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Zone 3: Wallet SOL Pill & Global Kill-Switch */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Wallet Balance Pill */}
          <button
            onClick={() => {
              haptics.selection();
              onOpenWalletModal();
            }}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-white/10 text-[11px] sm:text-xs font-mono transition-all active:scale-95"
            title="Wallet Balance"
          >
            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-400" />
            <span className="text-white font-bold tabular-nums">{walletSol.toFixed(2)}</span>
            <span className="text-emerald-400 text-[9px] sm:text-[10px] font-semibold">SOL</span>
          </button>

          {/* Emergency Kill-Switch Button */}
          <button
            onClick={() => {
              haptics.heavy();
              onOpenKillSwitch();
            }}
            className="group relative flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 text-red-400 hover:text-red-300 transition-all glow-crimson active:scale-90"
            title="Emergency Global Kill-Switch"
          >
            <ShieldAlert className="w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform group-hover:scale-110" />
            <span className="sr-only">Emergency Kill Switch</span>
          </button>
        </div>

      </div>
    </header>
  );
};
