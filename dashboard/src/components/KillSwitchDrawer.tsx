import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, X, Check, PowerOff, Flame } from 'lucide-react';
import { haptics } from '../services/haptics';

interface KillSwitchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmHalt: (liquidateAll: boolean) => void;
  isEngineActive: boolean;
  activePositionsCount: number;
}

export const KillSwitchDrawer: React.FC<KillSwitchDrawerProps> = ({
  isOpen,
  onClose,
  onConfirmHalt,
  isEngineActive,
  activePositionsCount
}) => {
  const [sliderPos, setSliderPos] = useState(0);
  const [includeLiquidation, setIncludeLiquidation] = useState(false);
  const [isTriggered, setIsTriggered] = useState(false);

  if (!isOpen) return null;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setSliderPos(val);
    if (val > 80 && !isTriggered) {
      haptics.heavy();
    }
    if (val >= 98 && !isTriggered) {
      setIsTriggered(true);
      haptics.error();
      setTimeout(() => {
        onConfirmHalt(includeLiquidation);
        setIsTriggered(false);
        setSliderPos(0);
        onClose();
      }, 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg glass-panel-elevated rounded-t-3xl sm:rounded-2xl border border-red-500/30 overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-250"
      >
        {/* Grab Handle for Mobile */}
        <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto my-3 sm:hidden" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-red-500/20 bg-red-950/20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 glow-crimson">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                GLOBAL KILL-SWITCH
              </h3>
              <p className="text-xs text-red-400 font-mono">Emergency Protocol Activated</p>
            </div>
          </div>
          <button
            onClick={() => {
              haptics.light();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-slate-900/60 border border-white/8 text-xs text-slate-300 leading-relaxed font-sans space-y-2">
            <div className="flex items-center gap-2 text-amber-400 font-mono font-semibold text-[11px]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>SAFETY INVARIANT PROTOCOL</span>
            </div>
            <p>
              Triggering this kill-switch immediately sends an abort signal to Jito Block Engines, stops the mempool listener, halts all automated DCA/Snipe tasks, and cancels pending transactions.
            </p>
          </div>

          {/* Option: Emergency Liquidate All Positions */}
          <div
            onClick={() => {
              haptics.selection();
              setIncludeLiquidation(!includeLiquidation);
            }}
            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer ${
              includeLiquidation
                ? 'bg-red-950/40 border-red-500/40 text-red-200'
                : 'bg-slate-900/40 border-white/8 text-slate-300 hover:bg-slate-900/70'
            }`}
          >
            <div className="flex items-center gap-3">
              <Flame className={`w-5 h-5 ${includeLiquidation ? 'text-red-400 animate-pulse' : 'text-slate-500'}`} />
              <div>
                <div className="text-xs font-semibold font-mono">
                  Emergency Market-Sell All Positions
                </div>
                <div className="text-[11px] text-slate-400">
                  Instantly dump {activePositionsCount} active token positions into SOL
                </div>
              </div>
            </div>
            <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
              includeLiquidation ? 'bg-red-500 border-red-400 text-white' : 'border-slate-600'
            }`}>
              {includeLiquidation && <Check className="w-3.5 h-3.5 stroke-[3]" />}
            </div>
          </div>

          {/* Slide to Confirm Lever */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>SLIDE TO CONFIRM HALT</span>
              <span className="text-red-400 font-bold">{sliderPos}%</span>
            </div>

            <div className="relative h-14 bg-slate-950 rounded-2xl border border-red-500/30 overflow-hidden flex items-center px-2 shadow-inner">
              {/* Glowing progress fill */}
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-950 to-red-600/40 transition-all duration-75"
                style={{ width: `${sliderPos}%` }}
              />

              {/* Shimmering Center Text */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xs font-mono font-bold tracking-wider uppercase text-red-300/80">
                  {sliderPos > 70 ? 'RELEASE TO EXECUTE' : '>>> SLIDE LEVER TO HALT >>>'}
                </span>
              </div>

              {/* Slider Input */}
              <input
                type="range"
                min="0"
                max="100"
                value={sliderPos}
                onChange={handleSliderChange}
                className="w-full h-full opacity-0 cursor-ew-resize relative z-10"
              />

              {/* Physical Lever Thumb */}
              <div
                className="absolute top-2 bottom-2 w-12 rounded-xl bg-gradient-to-b from-red-500 to-red-700 flex items-center justify-center text-white shadow-lg pointer-events-none transition-all duration-75"
                style={{
                  left: `calc(${sliderPos}% * 0.78 + 6px)`
                }}
              >
                <PowerOff className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Quick Cancel Button */}
          <button
            onClick={() => {
              haptics.light();
              onClose();
            }}
            className="w-full py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-mono text-slate-300 transition-colors"
          >
            Cancel & Return to Terminal
          </button>
        </div>
      </div>
    </div>
  );
};
