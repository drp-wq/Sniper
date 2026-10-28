/**
 * Bottom Navigation Bar (Android Mobile Standard)
 * 5 primary tabs with active state indicators and badge counters
 */

import React from 'react';
import {
  LayoutDashboard,
  Layers,
  Radio,
  BarChart3,
  Settings,
} from 'lucide-react';

export type TabId = 'dashboard' | 'positions' | 'signals' | 'analytics' | 'settings';

interface NavigationProps {
  currentTab: TabId;
  onSelectTab: (tab: TabId) => void;
  openPositionsCount: number;
  unresolvedCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentTab,
  onSelectTab,
  openPositionsCount,
  unresolvedCount,
}) => {
  const tabs: { id: TabId; label: string; icon: React.ElementType; badge?: number; badgeColor?: string }[] = [
    {
      id: 'dashboard',
      label: 'Command',
      icon: LayoutDashboard,
    },
    {
      id: 'positions',
      label: 'Positions',
      icon: Layers,
      badge: openPositionsCount > 0 ? openPositionsCount : undefined,
      badgeColor: unresolvedCount > 0 ? 'bg-amber-500' : 'bg-emerald-500',
    },
    {
      id: 'signals',
      label: 'Live Gate',
      icon: Radio,
    },
    {
      id: 'analytics',
      label: '2x Stress',
      icon: BarChart3,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0B0F17]/95 backdrop-blur border-t border-[#1F2937] px-2 py-1 pb-safe">
      <div className="max-w-md md:max-w-xl mx-auto flex items-center justify-around">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-lg transition-all min-w-[56px] ${
                isActive
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.8]'}`} />
                {tab.badge !== undefined && (
                  <span
                    className={`absolute -top-1.5 -right-2 px-1 min-w-[14px] h-[14px] text-[9px] font-bold text-black rounded-full flex items-center justify-center font-mono ${
                      tab.badgeColor || 'bg-emerald-500'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-0.5 tracking-tight ${isActive ? 'font-bold text-white' : 'font-medium'}`}>
                {tab.label}
              </span>
              {isActive && (
                <span className="w-1 h-1 rounded-full bg-emerald-400 mt-0.5" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
