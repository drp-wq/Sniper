import React, { useState } from 'react';
import { Wallet, X, Copy, Check, ArrowDownLeft, ArrowUpRight, ShieldCheck, Zap } from 'lucide-react';
import { haptics } from '../services/haptics';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletSol: number;
  onAddSol: (amount: number) => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  walletSol,
  onAddSol
}) => {
  const [copied, setCopied] = useState(false);
  const walletAddress = 'SolRelay89zP4gTfRsm12wYFvMvK8xQyW3mK9jD2pE5qR';

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard?.writeText?.(walletAddress);
    setCopied(true);
    haptics.success();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-sm glass-panel-elevated rounded-2xl p-5 border border-white/12 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/8 pb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Wallet className="w-4 h-4" />
            </div>
            <h4 className="text-sm font-bold font-mono text-white">Sniper Bot Embedded Wallet</h4>
          </div>
          <button
            onClick={() => {
              haptics.light();
              onClose();
            }}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Display */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-white/5 text-center space-y-1">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
            Available Solana Balance
          </span>
          <div className="text-3xl font-extrabold font-mono text-white tabular-nums">
            {walletSol.toFixed(2)} <span className="text-emerald-400 text-lg">SOL</span>
          </div>
          <div className="text-xs font-mono text-slate-400">
            ≈ ${(walletSol * 165.25).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </div>
        </div>

        {/* Address & Copy */}
        <div className="space-y-1">
          <span className="text-[10px] font-mono text-slate-400 uppercase">
            Dedicated Snipe Address
          </span>
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-white/10 text-xs font-mono text-slate-300">
            <span className="truncate pr-2">{walletAddress}</span>
            <button
              onClick={handleCopy}
              className="text-emerald-400 hover:text-emerald-300 shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Quick Test Deposit Simulation */}
        <div className="pt-2 space-y-2">
          <span className="text-[10px] font-mono text-slate-400 uppercase">
            Testnet Faucet / Simulation Deposit:
          </span>
          <div className="grid grid-cols-3 gap-2">
            {[1, 5, 10].map((amt) => (
              <button
                key={amt}
                onClick={() => {
                  haptics.success();
                  onAddSol(amt);
                }}
                className="py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-mono font-bold text-emerald-300 transition-all active:scale-95"
              >
                +{amt} SOL
              </button>
            ))}
          </div>
        </div>

        {/* Safety Note */}
        <div className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 text-[10px] font-mono text-slate-400 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Non-custodial ephemeral session key generated for Telegram Mini App container.</span>
        </div>
      </div>
    </div>
  );
};
