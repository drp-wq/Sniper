import React from 'react';
import { Radio, ShieldCheck, TrendingUp, Sparkles, Sliders } from 'lucide-react';
import { TabType } from '../types';
import { haptics } from '../services/haptics';

interface BottomNavDockProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  signalsCount: number;
  openPositionsCount: number;
}

export const BottomNavDock: React.FC<BottomNavDockProps> = ({
  activeTab,
  onChangeTab,
  signalsCount,
  openPositionsCount
}) => {
  const tabs = [
    {
      id: 'signals' as TabType,
      label: 'Stream',
      icon: Radio,
      badge: signalsCount > 0 ? `${signalsCount}` : null,
      badgeColor: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
    },
    {
      id: 'gate' as TabType,
      label: 'Gate',
      icon: ShieldCheck,
      badge: 'Audit',
      badgeColor: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
    },
    {
      id: 'positions' as TabType,
      label: 'PnL HUD',
      icon: TrendingUp,
      badge: openPositionsCount > 0 ? `${openPositionsCount}` : null,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
    },
    {
      id: 'strategy' as TabType,
      label: 'Strategy',
      icon: Sparkles,
      badge: 'PROFIT',
      badgeColor: 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
    },
    {
      id: 'config' as TabType,
      label: 'Engine',
      icon: Sliders,
      badge: null,
      badgeColor: ''
    }
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none pb-tg-safe px-2 sm:px-3">
      <div className="max-w-md mx-auto pointer-events-auto mb-2">
        <nav
          aria-label="Telegram Dock Navigation"
          className="relative flex items-center justify-around p-1 sm:p-1.5 rounded-2xl glass-panel-elevated shadow-2xl border border-white/12 backdrop-blur-2xl"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (activeTab !== tab.id) {
                    haptics.light();
                    onChangeTab(tab.id);
                  }
                }}
                className={`relative flex flex-col items-center justify-center py-1 sm:py-1.5 px-1.5 sm:px-2 rounded-xl transition-all duration-200 min-w-[56px] sm:min-w-[66px] min-h-[46px] select-none ${
                  isActive
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200 active:scale-95'
                }`}
              >
                {/* Active Glowing Pill Background Indicator */}
                {isActive && (
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/12 to-white/5 border border-white/15 shadow-inner glow-emerald" />
                )}

                {/* Tab Icon with Micro-bounce */}
                <div
                  className={`relative z-10 transition-transform duration-200 ${
                    isActive ? 'scale-110 text-emerald-400 -translate-y-0.5' : ''
                  }`}
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.2]" />
                  
                  {/* Subtle Badge */}
                  {tab.badge && (
                    <span
                      className={`absolute -top-1.5 -right-2.5 text-[8px] font-mono font-bold px-1 rounded-full ${tab.badgeColor}`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </div>

                {/* Tab Label */}
                <span
                  className={`relative z-10 text-[9px] sm:text-[10px] font-semibold tracking-wider font-mono uppercase mt-0.5 sm:mt-1 transition-colors ${
                    isActive ? 'text-emerald-300 font-bold' : 'text-slate-400'
                  }`}
                >
                  {tab.label}
                </span>

                {/* Active Indicator Underline Dot */}
                {isActive && (
                  <span className="relative z-10 w-1 h-1 rounded-full bg-emerald-400 mt-0.5 glow-emerald" />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
