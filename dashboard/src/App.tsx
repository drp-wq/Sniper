/**
 * Sniper Bot (Paper-Only Solana Scanner & Paper Trader)
 * Main Application Root
 * Strictly Paper / Shadow Trading Only
 */

import React, { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Navigation, TabId } from './components/Navigation';
import { TabDashboard } from './components/TabDashboard';
import { TabPositions } from './components/TabPositions';
import { TabSignals } from './components/TabSignals';
import { TabAnalytics } from './components/TabAnalytics';
import { TabSettings } from './components/TabSettings';
import { ApkModal } from './components/ApkModal';
import { ToastContainer } from './components/ToastContainer';
import { engine } from './services/engine';
import { generateBenchmarkTrades } from './services/sampleData';
import { Wifi, Battery, Signal, Zap } from 'lucide-react';

export default function App() {
  const [, setTick] = useState(0);
  const [currentTab, setCurrentTab] = useState<TabId>('dashboard');
  const [isMobilePreview, setIsMobilePreview] = useState(false);
  const [isApkModalOpen, setIsApkModalOpen] = useState(false);

  // Subscribe to engine state changes (real-time ticks, poll updates, gate verdicts)
  useEffect(() => {
    const unsubscribe = engine.subscribe(() => {
      setTick(t => t + 1);
    });

    // Check if we should pre-seed benchmark trades for instant gate evaluation
    const trades = engine.getClosedTrades();
    if (trades.length === 0) {
      const benchmark = generateBenchmarkTrades(200);
      engine.loadBenchmarkTrades(benchmark);
    }

    // Auto-refresh Worker state snapshot on mount
    engine.refreshWorkerKv().catch(() => {});

    return () => {
      unsubscribe();
    };
  }, []);

  const stats = engine.getStats();

  const renderCurrentTab = () => {
    switch (currentTab) {
      case 'dashboard':
        return <TabDashboard onNavigateToTab={setCurrentTab} />;
      case 'positions':
        return <TabPositions />;
      case 'signals':
        return <TabSignals />;
      case 'analytics':
        return <TabAnalytics />;
      case 'settings':
        return <TabSettings />;
      default:
        return <TabDashboard onNavigateToTab={setCurrentTab} />;
    }
  };

  const appContent = (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-zinc-100 select-none">
      {/* Top Application Bar with Mandatory PAPER MODE ONLY badge */}
      <TopBar
        isMobilePreview={isMobilePreview}
        onToggleMobilePreview={() => setIsMobilePreview(!isMobilePreview)}
        onOpenApkModal={() => setIsApkModalOpen(true)}
      />

      {/* Main Screen Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4">
        {renderCurrentTab()}
      </main>

      {/* 5 Bottom-Tab Navigation */}
      <Navigation
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        openPositionsCount={stats.openCount}
        unresolvedCount={stats.unresolvedCount}
      />

      {/* Toast Notification Container */}
      <ToastContainer
        toasts={engine.toasts}
        onDismiss={(id) => engine.dismissToast(id)}
      />

      {/* Android APK Packaging Modal */}
      <ApkModal
        isOpen={isApkModalOpen}
        onClose={() => setIsApkModalOpen(false)}
      />
    </div>
  );

  // If Mobile Preview Frame is toggled, render in a high-fidelity Android Device Mockup
  if (isMobilePreview) {
    return (
      <div className="min-h-screen bg-[#05070B] flex items-center justify-center p-2 sm:p-6 overflow-y-auto">
        <div className="relative w-full max-w-[430px] h-[890px] max-h-[96vh] bg-[#0B0F17] rounded-[48px] border-[10px] border-[#1F2937] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden ring-1 ring-zinc-700/50">
          
          {/* Android Status Bar */}
          <div className="h-7 bg-[#0B0F17] px-6 flex items-center justify-between text-[11px] font-mono text-zinc-400 select-none border-b border-zinc-900/60 z-50">
            <span>09:41</span>
            <div className="w-20 h-4 bg-zinc-950 rounded-full mx-auto border border-zinc-800 flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-zinc-800" />
            </div>
            <div className="flex items-center gap-1.5">
              <Signal className="w-3 h-3" />
              <Wifi className="w-3 h-3" />
              <Battery className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Screen Content within Mobile Container */}
          <div className="flex-1 overflow-y-auto relative">
            {appContent}
          </div>

          {/* Android Bottom Navigation Bar Indicator */}
          <div className="h-3 bg-[#0B0F17] flex items-center justify-center pb-1 z-50">
            <div className="w-32 h-1 bg-zinc-600 rounded-full" />
          </div>

        </div>
      </div>
    );
  }

  // Standard responsive layout (fills browser window / WebView seamlessly)
  return appContent;
}
