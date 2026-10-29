import React, { useState } from 'react';
import { Smartphone, Monitor, Wifi, Battery, ChevronLeft, MoreVertical, X } from 'lucide-react';
import { haptics } from '../services/haptics';

interface TelegramFrameWrapperProps {
  children: React.ReactNode;
  activeRpcName: string;
}

export const TelegramFrameWrapper: React.FC<TelegramFrameWrapperProps> = ({
  children,
  activeRpcName
}) => {
  const [isMobileFrameMode, setIsMobileFrameMode] = useState(true);

  return (
    <div className="min-h-screen bg-[#05070B] text-slate-100 flex flex-col items-center">
      
      {/* Top Floating Viewport Switcher Banner (Anti-Desert-Island & Developer Toggle) */}
      <div className="w-full bg-[#0D111A] border-b border-white/8 py-1.5 px-4 flex items-center justify-between text-xs font-mono z-40">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white font-bold tracking-tight">SolRelay</span>
          <span className="text-slate-400 hidden sm:inline">· Solana HFT Sniper Bot Telegram Mini App</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              haptics.selection();
              setIsMobileFrameMode(!isMobileFrameMode);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-all active:scale-95"
            title="Toggle between Telegram Mobile Frame and Expanded Desktop View"
          >
            {isMobileFrameMode ? (
              <>
                <Monitor className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Switch to Expanded Pro View</span>
                <span className="sm:hidden">Pro View</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Switch to Telegram Mobile Frame</span>
                <span className="sm:hidden">Mobile Frame</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Container */}
      {isMobileFrameMode ? (
        /* Realistic Telegram Mobile OLED Frame (iPhone 16 Pro Dimensions) */
        <div className="w-full flex-1 flex items-center justify-center p-2 sm:p-6 sm:py-8">
          <div className="relative w-full max-w-[420px] h-[92vh] sm:h-[860px] max-h-[900px] bg-[#080B11] sm:rounded-[48px] sm:border-[8px] sm:border-slate-800/80 shadow-[0_0_50px_rgba(0,0,0,0.8),0_0_20px_rgba(16,185,129,0.1)] flex flex-col overflow-hidden">
            
            {/* Telegram App Header Bar */}
            <div className="shrink-0 bg-[#0E1621] border-b border-white/8 px-4 pt-3 pb-2.5 flex items-center justify-between select-none">
              <div className="flex items-center gap-2 text-slate-300">
                <ChevronLeft className="w-5 h-5 -ml-1 text-[#2481CC]" />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-white leading-tight">
                    SolRelay Sniper OS
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono leading-none">
                    bot · {activeRpcName}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-slate-400">
                <button
                  onClick={() => haptics.light()}
                  className="p-1 hover:text-white"
                  title="Telegram Mini App Options"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                <button
                  onClick={() => haptics.light()}
                  className="p-1 hover:text-white"
                  title="Close Mini App"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Mini App Inner Viewport */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col">
              {children}
            </div>

            {/* Mobile Home Swipe Indicator Bar */}
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/20 rounded-full pointer-events-none z-50" />
          </div>
        </div>
      ) : (
        /* Full Desktop / Tablet Expanded Pro View */
        <div className="w-full max-w-5xl flex-1 flex flex-col p-4 sm:p-6">
          <div className="flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      )}

    </div>
  );
};
