/**
 * SolRelay Sniper OS
 * Telegram Mini App & High-Frequency Paper Trading Terminal
 * Connected End-to-End with Live Engine, Solana RPC Gate, DexScreener Quotes, and Worker Relay
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TabType, TokenSignal, Position, RpcNode, SniperConfig, PriceAlert, PaperPosition, SignalLogItem } from './types';
import {
  INITIAL_RPC_NODES,
  INITIAL_SIGNALS,
  INITIAL_POSITIONS,
  DEFAULT_SNIPER_CONFIG
} from './services/mockData';
import { TopBar } from './components/TopBar';
import { BottomNavDock } from './components/BottomNavDock';
import { SignalStreamFeed } from './components/SignalStreamFeed';
import { SafetyGateInspector } from './components/SafetyGateInspector';
import { PositionsHUD } from './components/PositionsHUD';
import { SniperConfigTab } from './components/SniperConfigTab';
import { TabStrategy } from './components/TabStrategy';
import { KillSwitchDrawer } from './components/KillSwitchDrawer';
import { WalletModal } from './components/WalletModal';
import { TelegramFrameWrapper } from './components/TelegramFrameWrapper';
import { haptics } from './services/haptics';
import { engine } from './services/engine';
import { WorkerApi } from './services/workerApi';
import { TelegramService } from './services/telegram';
import { SolanaRpc } from './services/solanaRpc';
import { CheckCircle2, AlertOctagon, BellRing } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('positions');
  const [walletSol, setWalletSol] = useState<number>(42.50);
  const [rpcNodes, setRpcNodes] = useState<RpcNode[]>(INITIAL_RPC_NODES);
  const [activeRpc, setActiveRpc] = useState<RpcNode>(INITIAL_RPC_NODES[0]);
  const [signals, setSignals] = useState<TokenSignal[]>(INITIAL_SIGNALS);
  const [positions, setPositions] = useState<Position[]>(INITIAL_POSITIONS);
  const [sniperConfig, setSniperConfig] = useState<SniperConfig>(DEFAULT_SNIPER_CONFIG);

  const [isKillSwitchOpen, setIsKillSwitchOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [inspectedMint, setInspectedMint] = useState<string>('Cat9ZpC4gTfRsm12wYFvMvK8xQyW3mK9jD2pE5qR8sT1');
  const [toastMessage, setToastMessage] = useState<{ title: string; subtitle: string; type: 'success' | 'alert' | 'info' } | null>(null);

  // Helper to show in-app toasts
  const showToast = useCallback((title: string, subtitle: string, type: 'success' | 'alert' | 'info' = 'success') => {
    setToastMessage({ title, subtitle, type });
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  // Map engine PaperPosition into UI Position model
  const mapPaperPositionToUi = useCallback((pos: PaperPosition): Position => {
    const solPriceUsd = 165.25;
    const initialSolInvested = Number((pos.stakeUsd / solPriceUsd).toFixed(3));
    const currentSolValue = Number(((pos.stakeUsd + pos.unrealizedPnlUsd) / solPriceUsd).toFixed(3));
    const pnlSol = Number((pos.unrealizedPnlUsd / solPriceUsd).toFixed(3));
    const pnlPercent = Number(pos.unrealizedPnlPct.toFixed(2));
    const stopPriceUsd = pos.peakExecutablePrice * (1 - (engine.getConfig().trailingStopPullbackPct || 20) / 100);

    return {
      id: pos.id,
      symbol: pos.symbol,
      name: pos.name,
      mint: pos.mint,
      dex: (pos.pairAddress?.toLowerCase().includes('pump') ? 'Pump.fun' : 'Raydium') as any,
      entryPriceUsd: pos.entryPrice,
      currentPriceUsd: pos.currentQuotePrice,
      tokensAmount: pos.shares,
      initialSolInvested,
      currentSolValue,
      pnlSol,
      pnlPercent,
      sparkline: pos.priceHistory && pos.priceHistory.length >= 2 ? pos.priceHistory : [pos.entryPrice, pos.currentQuotePrice],
      trailingStopPercent: engine.getConfig().trailingStopPullbackPct || 20,
      highestPriceUsd: pos.peakExecutablePrice,
      stopPriceUsd,
      takeProfitTiers: pos.takeProfitTiers || [
        { tier: 1, targetPercent: 50, hit: pos.trailingArmed, sellPortionPercent: 0, lockFloorPercent: 10, tightenedTrailingPercent: 15 },
        { tier: 2, targetPercent: 100, hit: pos.tookHalf, sellPortionPercent: 50, lockFloorPercent: 40, tightenedTrailingPercent: 10 },
        { tier: 3, targetPercent: 250, hit: false, sellPortionPercent: 100, lockFloorPercent: 120, tightenedTrailingPercent: 8 }
      ],
      alerts: pos.alerts || [],
      autoSellTriggerEnabled: true,
      autoSellPortionPercent: 50,
      jitoPriorityFeeSol: 0.002,
      antiMevEnabled: true,
      trailingStopActive: pos.trailingArmed,
      smartProfitLockEnabled: pos.smartProfitLockEnabled ?? true,
      smartProfitLockMode: pos.smartProfitLockMode ?? 'BREAKEVEN_SHIELD',
      smartProfitFloorPercent: pos.smartProfitFloorPercent ?? 0,
      smartProfitLockStage: pos.smartProfitLockStage ?? 0,
      timestamp: new Date(pos.openedAt).toISOString(),
      isDemo: false
    };
  }, []);

  // Map engine SignalLogItem into UI TokenSignal
  const mapLogToSignal = useCallback((log: SignalLogItem): TokenSignal => {
    const q = log.quote;
    const isRaydium = (q?.dexId || '').toLowerCase().includes('raydium') || !q?.pairAddress?.toLowerCase().includes('pump');
    return {
      id: log.id,
      symbol: q?.symbol || log.mint.slice(0, 5).toUpperCase(),
      name: q?.name || `Token ${log.mint.slice(0, 4)}`,
      mint: log.mint,
      pairAddress: q?.pairAddress || log.sig || 'RayPool...',
      dex: isRaydium ? 'Raydium' : 'Pump.fun',
      dexColor: isRaydium ? '#06B6D4' : '#10B981',
      initialSolLiquidity: q?.liqUsd ? Math.round(q.liqUsd / 165.25) : 40,
      marketCapUsd: q ? Math.round(q.priceUsd * (log.gateVerdict?.supply || 1000000000)) : 145000,
      priceUsd: q?.priceUsd || 0.00012,
      priceDelta5m: q?.priceChange24h || 18.4,
      sparkline: [20, 24, 28, 35, 48, 62, 75, 88, 92],
      safetyScore: log.gateVerdict?.passed ? 96 : 35,
      isMintRevoked: log.gateVerdict?.mintAuthority === null,
      isFreezeRevoked: log.gateVerdict?.freezeAuthority === null,
      hasToken2022Extensions: !!log.gateVerdict?.isToken2022,
      top10HoldersPercent: log.gateVerdict?.top10Pct || 14.2,
      devHoldingPercent: 2.1,
      lpBurned: true,
      detectedSecondsAgo: Math.max(1, Math.round((Date.now() - log.receivedAt) / 1000)),
      isDemo: false
    };
  }, []);

  // Initialize Telegram Mini App & connect to Engine
  useEffect(() => {
    TelegramService.init();

    // Subscribe to engine state updates (ticks, price changes, gate verdicts, position exits)
    const unsubscribe = engine.subscribe(() => {
      const openPositions = engine.getOpenPositions();
      if (openPositions.length > 0) {
        setPositions(openPositions.map(mapPaperPositionToUi));
      }

      // Sync signals stream from engine signal logs if available
      const logs = engine.getSignalLogs();
      if (logs.length > 0) {
        const mappedLogs = logs.slice(0, 15).map(mapLogToSignal);
        setSignals((prev) => {
          const merged = [...mappedLogs];
          prev.forEach((s) => {
            if (!merged.some((m) => m.mint === s.mint)) {
              merged.push(s);
            }
          });
          return merged;
        });
      }

      // Catch engine toasts and surface them in UI
      if (engine.toasts.length > 0) {
        const latest = engine.toasts[engine.toasts.length - 1];
        if (latest) {
          showToast(latest.title, latest.message, latest.type === 'buy' || latest.type === 'tp' ? 'success' : latest.type === 'sl' ? 'alert' : 'info');
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [mapPaperPositionToUi, mapLogToSignal, showToast]);

  // Helper to trigger system price alert
  const triggerSystemPriceAlert = (
    position: Position,
    alert: PriceAlert,
    currentPrice: number
  ) => {
    const isTp = alert.type === 'TAKE_PROFIT';
    const title = isTp
      ? `🎯 TAKE PROFIT TRIGGERED: $${position.symbol}`
      : `⚠️ STOP LOSS TRIGGERED: $${position.symbol}`;
    const subtitle = `Price reached $${currentPrice.toFixed(6)} (Target: $${alert.targetPriceUsd.toFixed(6)})${
      alert.autoExecuteSellPercent ? ` · Auto-Sold ${alert.autoExecuteSellPercent}%` : ''
    }`;

    if (isTp) {
      haptics.success();
      showToast(title, subtitle, 'success');
    } else {
      haptics.error();
      showToast(title, subtitle, 'alert');
    }

    // Attempt browser Notification if permission is granted
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body: subtitle });
      }
    } catch {}

    // Auto-execute sell if configured
    if (alert.autoExecuteSellPercent && alert.autoExecuteSellPercent > 0) {
      handleSellPosition(position.id, alert.autoExecuteSellPercent);
    }
  };

  // Real Solana RPC telemetry monitor (Slot and Latency)
  useEffect(() => {
    let isMounted = true;
    const updateRpcTelemetry = async () => {
      const cfg = engine.getConfig();
      const targetRpc = activeRpc.id === 'solana-public' ? 'https://solana-rpc.publicnode.com' : cfg.rpcUrl;
      const res = await SolanaRpc.checkHealth(targetRpc);
      if (!isMounted) return;

      if (res.ok) {
        const latency = res.latencyMs;
        const slot = res.slot || activeRpc.blockHeight;
        const status = latency < 120 ? 'optimal' : latency < 300 ? 'moderate' : 'degraded';
        setActiveRpc((prev) => ({
          ...prev,
          latencyMs: latency,
          blockHeight: slot,
          status,
        }));
        setRpcNodes((nodes) =>
          nodes.map((n) =>
            n.id === activeRpc.id
              ? { ...n, latencyMs: latency, blockHeight: slot, status }
              : n
          )
        );
      } else {
        setActiveRpc((prev) => ({ ...prev, latencyMs: res.latencyMs, status: 'degraded' }));
      }
    };

    updateRpcTelemetry();
    const interval = setInterval(updateRpcTelemetry, 10000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeRpc.id]);

  // Demo simulator tick evaluator (runs ONLY when displaying demo preview data; real positions update via DexScreener quotes)
  useEffect(() => {
    const interval = setInterval(() => {
      setPositions((prev) => {
        // If real paper positions exist from engine, do NOT fabricate synthetic prices!
        const hasLivePositions = prev.some((p) => !p.isDemo);
        if (hasLivePositions) {
          // Only evaluate pending alerts on live quotes
          return prev.map((pos) => {
            if (!pos.alerts || pos.alerts.length === 0) return pos;
            const updatedAlerts = pos.alerts.map((alert) => {
              if (!alert.triggered) {
                const conditionMet =
                  alert.type === 'TAKE_PROFIT'
                    ? pos.currentPriceUsd >= alert.targetPriceUsd
                    : pos.currentPriceUsd <= alert.targetPriceUsd;
                if (conditionMet) {
                  triggerSystemPriceAlert(pos, alert, pos.currentPriceUsd);
                  return { ...alert, triggered: true };
                }
              }
              return alert;
            });
            return { ...pos, alerts: updatedAlerts };
          });
        }

        // Demo positions only: gentle mock tick to demonstrate HUD functionality
        return prev.map((pos) => {
          const delta = (Math.random() - 0.48) * 0.00008 * (pos.currentPriceUsd > 0.01 ? 10 : 1);
          const nextPrice = Math.max(0.000001, pos.currentPriceUsd + delta);
          const highest = Math.max(pos.highestPriceUsd, nextPrice);
          const pnlPercent = ((nextPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
          const currentSolValue = (pos.tokensAmount * nextPrice) / 165.25;
          const pnlSol = currentSolValue - pos.initialSolInvested;

          let currentTrailingPct = pos.trailingStopPercent;
          let currentLockStage = pos.smartProfitLockStage || 0;
          let currentLockFloor = pos.smartProfitFloorPercent || 0;
          let newlyHitTierMsg: string | null = null;

          const updatedTiers = (pos.takeProfitTiers || []).map((tier) => {
            if (!tier.hit && pnlPercent >= tier.targetPercent) {
              if (pos.smartProfitLockEnabled) {
                if (tier.tightenedTrailingPercent) {
                  currentTrailingPct = tier.tightenedTrailingPercent;
                }
                if (tier.lockFloorPercent !== undefined && tier.lockFloorPercent > currentLockFloor) {
                  currentLockFloor = tier.lockFloorPercent;
                  currentLockStage = tier.tier;
                  newlyHitTierMsg = `🎯 Smart Profit Tier ${tier.tier} Locked: Floor +${tier.lockFloorPercent}% (Tightened Trail: ${tier.tightenedTrailingPercent}%)`;
                }
              }
              return { ...tier, hit: true };
            }
            return tier;
          });

          if (newlyHitTierMsg) {
            haptics.success();
            showToast('Profit Lock Tier Activated', newlyHitTierMsg, 'success');
          }

          let calculatedStopPrice = highest * (1 - currentTrailingPct / 100);
          if (pos.smartProfitLockEnabled && currentLockFloor > 0) {
            const floorPrice = pos.entryPriceUsd * (1 + currentLockFloor / 100);
            calculatedStopPrice = Math.max(calculatedStopPrice, floorPrice);
          }

          const updatedSparkline = [...pos.sparkline.slice(-18), nextPrice * 100000];

          // Evaluate alerts
          const updatedAlerts = (pos.alerts || []).map((alert) => {
            if (!alert.triggered) {
              const conditionMet =
                alert.type === 'TAKE_PROFIT'
                  ? nextPrice >= alert.targetPriceUsd
                  : nextPrice <= alert.targetPriceUsd;

              if (conditionMet) {
                triggerSystemPriceAlert(pos, alert, nextPrice);
                return { ...alert, triggered: true };
              }
            }
            return alert;
          });

          return {
            ...pos,
            currentPriceUsd: nextPrice,
            highestPriceUsd: highest,
            stopPriceUsd: calculatedStopPrice,
            pnlPercent,
            currentSolValue,
            pnlSol,
            sparkline: updatedSparkline,
            trailingStopPercent: currentTrailingPct,
            smartProfitFloorPercent: currentLockFloor,
            smartProfitLockStage: currentLockStage,
            takeProfitTiers: updatedTiers,
            alerts: updatedAlerts
          };
        });
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [showToast]);

  // Execute Paper Snipe (End-to-End connected)
  const handleSnipeToken = useCallback((signal: TokenSignal) => {
    haptics.heavy();
    const buySol = sniperConfig.defaultBuySol;

    if (walletSol < buySol) {
      showToast('Insufficient Paper SOL', `Require ${buySol} SOL, available: ${walletSol.toFixed(2)} SOL`, 'alert');
      return;
    }

    setWalletSol((prev) => Math.max(0, prev - buySol));

    // Connect directly to live PaperTradingEngine
    engine.openPaperPosition(signal.mint, signal.symbol, {
      mint: signal.mint,
      symbol: signal.symbol,
      name: signal.name,
      pairAddress: signal.pairAddress,
      priceUsd: signal.priceUsd,
      liqUsd: signal.initialSolLiquidity * 165.25,
      updatedAt: Date.now()
    });

    const tokensAmount = Math.floor((buySol * 165.25) / signal.priceUsd);
    const newPosition: Position = {
      id: `pos-${Date.now()}`,
      symbol: signal.symbol,
      name: signal.name,
      mint: signal.mint,
      dex: (signal.dex === 'Pump.fun' ? 'Pump.fun' : 'Raydium'),
      entryPriceUsd: signal.priceUsd,
      currentPriceUsd: signal.priceUsd,
      tokensAmount,
      initialSolInvested: buySol,
      currentSolValue: buySol,
      pnlSol: 0,
      pnlPercent: 0,
      sparkline: [signal.priceUsd * 100000, signal.priceUsd * 100000],
      trailingStopPercent: sniperConfig.trailingStopLossPercent,
      highestPriceUsd: signal.priceUsd,
      stopPriceUsd: signal.priceUsd * (1 - sniperConfig.trailingStopLossPercent / 100),
      takeProfitTiers: [
        { tier: 1, targetPercent: sniperConfig.tp1Percent, hit: false, sellPortionPercent: 30, lockFloorPercent: 10, tightenedTrailingPercent: 14 },
        { tier: 2, targetPercent: sniperConfig.tp2Percent, hit: false, sellPortionPercent: 40, lockFloorPercent: 45, tightenedTrailingPercent: 10 },
        { tier: 3, targetPercent: sniperConfig.tp3Percent, hit: false, sellPortionPercent: 100, lockFloorPercent: 120, tightenedTrailingPercent: 8 }
      ],
      alerts: [
        {
          id: `alert-tp-${Date.now()}`,
          positionId: `pos-${Date.now()}`,
          symbol: signal.symbol,
          type: 'TAKE_PROFIT',
          targetPriceUsd: signal.priceUsd * (1 + sniperConfig.tp1Percent / 100),
          deltaPercentFromCurrent: sniperConfig.tp1Percent,
          triggered: false,
          createdAt: new Date().toLocaleTimeString(),
          autoExecuteSellPercent: 50
        },
        {
          id: `alert-sl-${Date.now()}`,
          positionId: `pos-${Date.now()}`,
          symbol: signal.symbol,
          type: 'STOP_LOSS',
          targetPriceUsd: signal.priceUsd * (1 - sniperConfig.trailingStopLossPercent / 100),
          deltaPercentFromCurrent: -sniperConfig.trailingStopLossPercent,
          triggered: false,
          createdAt: new Date().toLocaleTimeString(),
          autoExecuteSellPercent: 100
        }
      ],
      autoSellTriggerEnabled: true,
      autoSellPortionPercent: 50,
      jitoPriorityFeeSol: sniperConfig.jitoTipSol,
      antiMevEnabled: sniperConfig.antiMevEnabled,
      trailingStopActive: true,
      smartProfitLockEnabled: true,
      smartProfitLockMode: 'BREAKEVEN_SHIELD',
      smartProfitFloorPercent: 0,
      smartProfitLockStage: 0,
      timestamp: 'Just now',
      isDemo: false
    };

    setPositions((prev) => {
      const liveOnly = prev.filter((p) => !p.isDemo);
      return [newPosition, ...liveOnly];
    });
    setSignals((prev) =>
      prev.map((s) => (s.id === signal.id ? { ...s, isSniped: true } : s))
    );

    showToast(`Sniped $${signal.symbol}`, `Allocated ${buySol} Paper SOL via Jito MEV`, 'success');
  }, [sniperConfig, walletSol, showToast]);

  // Execute Position Sell / Liquidation (End-to-End connected)
  const handleSellPosition = useCallback((positionId: string, portionPercent: number) => {
    haptics.heavy();
    const targetPos = positions.find((p) => p.id === positionId);
    if (!targetPos) return;

    const solRecovered = (targetPos.currentSolValue * portionPercent) / 100;
    setWalletSol((prev) => prev + solRecovered);

    // Call engine manualClose
    engine.manualClose(positionId);

    if (portionPercent >= 100) {
      setPositions((prev) => prev.filter((p) => p.id !== positionId));
      showToast(
        `Sold 100% $${targetPos.symbol}`,
        `Recovered ${solRecovered.toFixed(2)} SOL (PnL: ${targetPos.pnlPercent >= 0 ? '+' : ''}${targetPos.pnlPercent.toFixed(1)}%)`,
        targetPos.pnlPercent >= 0 ? 'success' : 'alert'
      );
    } else {
      setPositions((prev) =>
        prev.map((p) => {
          if (p.id !== positionId) return p;
          const remainingFactor = (100 - portionPercent) / 100;
          return {
            ...p,
            tokensAmount: p.tokensAmount * remainingFactor,
            initialSolInvested: p.initialSolInvested * remainingFactor,
            currentSolValue: p.currentSolValue * remainingFactor,
            pnlSol: p.pnlSol * remainingFactor
          };
        })
      );
      showToast(
        `Sold ${portionPercent}% $${targetPos.symbol}`,
        `Banked ${solRecovered.toFixed(2)} SOL`,
        'success'
      );
    }
  }, [positions, showToast]);

  // Trailing Stop Adjustment
  const handleUpdateTrailingStop = useCallback((positionId: string, newPercent: number) => {
    haptics.medium();
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== positionId) return pos;
        const newStopPrice = pos.highestPriceUsd * (1 - newPercent / 100);
        return {
          ...pos,
          trailingStopPercent: newPercent,
          stopPriceUsd: newStopPrice
        };
      })
    );
    showToast('Trailing Stop Ratcheted', `Tightened to ${newPercent}% from peak`, 'info');
  }, [showToast]);

  // Add Dynamic Alert
  const handleAddPriceAlert = useCallback((
    positionId: string,
    alertData: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered' | 'positionId' | 'symbol'>
  ) => {
    haptics.success();
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== positionId) return pos;
        const newAlert: PriceAlert = {
          ...alertData,
          id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          positionId: pos.id,
          symbol: pos.symbol,
          createdAt: new Date().toLocaleTimeString(),
          triggered: false
        };
        return {
          ...pos,
          alerts: [...(pos.alerts || []), newAlert]
        };
      })
    );
    showToast('Price Alert Scheduled', `Monitoring $${alertData.targetPriceUsd.toFixed(6)}`, 'success');
  }, [showToast]);

  // Delete Alert
  const handleDeletePriceAlert = useCallback((positionId: string, alertId: string) => {
    haptics.medium();
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== positionId) return pos;
        return {
          ...pos,
          alerts: (pos.alerts || []).filter((a) => a.id !== alertId)
        };
      })
    );
    showToast('Alert Removed', 'Target trigger deactivated', 'info');
  }, [showToast]);

  // Test Trigger an Alert
  const handleTestTriggerAlert = useCallback((positionId: string, alertId: string) => {
    const pos = positions.find((p) => p.id === positionId);
    if (!pos) return;
    const alert = (pos.alerts || []).find((a) => a.id === alertId);
    if (!alert) return;

    triggerSystemPriceAlert(pos, alert, pos.currentPriceUsd);
    setPositions((prev) =>
      prev.map((p) => {
        if (p.id !== positionId) return p;
        return {
          ...p,
          alerts: (p.alerts || []).map((a) =>
            a.id === alertId ? { ...a, triggered: true } : a
          )
        };
      })
    );
  }, [positions]);

  // Clear Alerts
  const handleClearAllAlerts = useCallback(() => {
    haptics.light();
    setPositions((prev) => prev.map((pos) => ({ ...pos, alerts: [] })));
    showToast('Alerts Cleared', 'All price alerts purged', 'info');
  }, [showToast]);

  const handleClearAlertsByType = useCallback((type: 'TAKE_PROFIT' | 'STOP_LOSS') => {
    haptics.light();
    setPositions((prev) =>
      prev.map((pos) => ({
        ...pos,
        alerts: (pos.alerts || []).filter((a) => a.type !== type)
      }))
    );
    showToast('Alerts Cleared', `Cleared all ${type === 'TAKE_PROFIT' ? 'Take Profit' : 'Stop Loss'} triggers`, 'info');
  }, [showToast]);

  const handleTriggerAllAlerts = useCallback(() => {
    positions.forEach((pos) => {
      (pos.alerts || []).forEach((alert) => {
        if (!alert.triggered) {
          triggerSystemPriceAlert(pos, alert, pos.currentPriceUsd);
        }
      });
    });
    setPositions((prev) =>
      prev.map((pos) => ({
        ...pos,
        alerts: (pos.alerts || []).map((a) => ({ ...a, triggered: true }))
      }))
    );
  }, [positions]);

  const handleUpdatePositionStrategy = useCallback((positionId: string, updates: Partial<Position>) => {
    setPositions((prev) =>
      prev.map((pos) => (pos.id === positionId ? { ...pos, ...updates } : pos))
    );
  }, []);

  const handleSimulateProfitLockTier = useCallback((positionId: string, tierNumber: number) => {
    haptics.success();
    setPositions((prev) =>
      prev.map((pos) => {
        if (pos.id !== positionId) return pos;
        const targetTier = pos.takeProfitTiers?.find((t) => t.tier === tierNumber);
        if (!targetTier) return pos;

        const simulatedPnlPct = targetTier.targetPercent + 2;
        const simulatedPrice = pos.entryPriceUsd * (1 + simulatedPnlPct / 100);
        const lockFloor = targetTier.lockFloorPercent || 15;
        const tightenedTrail = targetTier.tightenedTrailingPercent || 10;
        const floorPrice = pos.entryPriceUsd * (1 + lockFloor / 100);

        showToast(
          `Simulated Tier ${tierNumber} Hit!`,
          `P&L reached +${simulatedPnlPct.toFixed(1)}%. Locked floor at +${lockFloor}% ($${floorPrice.toFixed(6)}) with ${tightenedTrail}% trail`,
          'success'
        );

        return {
          ...pos,
          currentPriceUsd: simulatedPrice,
          highestPriceUsd: Math.max(pos.highestPriceUsd, simulatedPrice),
          pnlPercent: simulatedPnlPct,
          smartProfitFloorPercent: lockFloor,
          smartProfitLockStage: tierNumber,
          trailingStopPercent: tightenedTrail,
          stopPriceUsd: floorPrice,
          takeProfitTiers: (pos.takeProfitTiers || []).map((t) =>
            t.tier === tierNumber ? { ...t, hit: true } : t
          )
        };
      })
    );
  }, [showToast]);

  // Emergency Global Kill-Switch (End-to-End connected)
  const handleConfirmHalt = useCallback(async (liquidateAll: boolean) => {
    haptics.error();
    
    // Set local halt in paper trading engine
    engine.setLocalHalt(true);
    
    // Send remote halt to Cloudflare Worker
    try {
      await engine.setRemoteHalt(true);
    } catch {}

    setSniperConfig((prev) => ({ ...prev, autoSnipeEnabled: false }));

    if (liquidateAll && positions.length > 0) {
      let totalRecovered = 0;
      positions.forEach((p) => {
        totalRecovered += p.currentSolValue;
        engine.manualClose(p.id);
      });
      setWalletSol((prev) => prev + totalRecovered);
      setPositions([]);
      showToast(
        'EMERGENCY LIQUIDATION COMPLETE',
        `Closed ${positions.length} positions. Recovered ${totalRecovered.toFixed(2)} Paper SOL. Engine Halted.`,
        'alert'
      );
    } else {
      showToast(
        'ENGINE HALTED',
        'Auto-sniper halted locally and remotely. Open positions preserved with active trailing stops.',
        'alert'
      );
    }
  }, [positions, showToast]);

  return (
    <TelegramFrameWrapper activeRpcName={activeRpc.name}>
      {/* Top Application Bar with Paper Mode Safety Badge & Kill Switch */}
      <TopBar
        walletSol={walletSol}
        activeRpc={activeRpc}
        allRpcNodes={rpcNodes}
        onSelectRpc={(node) => {
          setActiveRpc(node);
          showToast(`Switched RPC Endpoint`, `Route set to ${node.name} (${node.latencyMs}ms)`, 'info');
        }}
        isEngineActive={sniperConfig.autoSnipeEnabled && !engine.isLocalHaltActive()}
        onOpenKillSwitch={() => setIsKillSwitchOpen(true)}
        onOpenWalletModal={() => setIsWalletModalOpen(true)}
      />

      {/* Main Multi-Tab Viewport */}
      <main className="flex-1 px-3 pt-3 pb-28 max-w-lg mx-auto w-full">
        {activeTab === 'signals' && (
          <SignalStreamFeed
            signals={signals}
            onQuickAudit={(mint) => {
              setInspectedMint(mint);
              setActiveTab('gate');
              haptics.selection();
            }}
            onSnipeToken={handleSnipeToken}
            isSniperActive={sniperConfig.autoSnipeEnabled}
            defaultBuySol={sniperConfig.defaultBuySol}
          />
        )}

        {activeTab === 'gate' && (
          <SafetyGateInspector
            initialMint={inspectedMint}
            onQuickSnipe={(mint, symbol) => {
              const matchedSignal = signals.find((s) => s.mint === mint) || {
                id: `sig-${Date.now()}`,
                symbol,
                name: symbol,
                mint,
                pairAddress: 'RayPool...',
                dex: 'Raydium',
                dexColor: '#10B981',
                initialSolLiquidity: 50,
                marketCapUsd: 100000,
                priceUsd: 0.0001,
                priceDelta5m: 10,
                sparkline: [20, 30, 40, 50, 60],
                safetyScore: 98,
                isMintRevoked: true,
                isFreezeRevoked: true,
                hasToken2022Extensions: false,
                top10HoldersPercent: 14,
                devHoldingPercent: 2,
                lpBurned: true,
                detectedSecondsAgo: 2
              };
              handleSnipeToken(matchedSignal);
              setActiveTab('positions');
            }}
          />
        )}

        {activeTab === 'positions' && (
          <PositionsHUD
            positions={positions}
            onSellPosition={handleSellPosition}
            onUpdateTrailingStop={handleUpdateTrailingStop}
            onAddPriceAlert={handleAddPriceAlert}
            onDeletePriceAlert={handleDeletePriceAlert}
            onTestTriggerAlert={handleTestTriggerAlert}
            onClearAllAlerts={handleClearAllAlerts}
            onClearAlertsByType={handleClearAlertsByType}
            onTriggerAllAlerts={handleTriggerAllAlerts}
            onUpdatePositionStrategy={handleUpdatePositionStrategy}
            onSimulateProfitLockTier={handleSimulateProfitLockTier}
          />
        )}

        {activeTab === 'strategy' && (
          <div className="space-y-4 pb-20">
            <TabStrategy />
          </div>
        )}

        {activeTab === 'config' && (
          <SniperConfigTab
            config={sniperConfig}
            onUpdateConfig={(updates) => {
              setSniperConfig((prev) => ({ ...prev, ...updates }));
              // Update engine config
              if (updates.slippageTolerancePercent !== undefined) {
                engine.updateConfig({ entrySlip: updates.slippageTolerancePercent / 100 });
              }
              if (updates.trailingStopLossPercent !== undefined) {
                engine.updateConfig({ trailingStopPullbackPct: updates.trailingStopLossPercent });
              }
              showToast('Configuration Saved', 'Sniper engine parameters updated', 'info');
            }}
            walletBalanceSol={walletSol}
          />
        )}
      </main>

      {/* Floating Bottom Glassmorphic Navigation Dock */}
      <BottomNavDock
        activeTab={activeTab}
        onChangeTab={(tab) => setActiveTab(tab)}
        signalsCount={signals.length}
        openPositionsCount={positions.length}
      />

      {/* Global Kill-Switch Slide Drawer */}
      <KillSwitchDrawer
        isOpen={isKillSwitchOpen}
        onClose={() => setIsKillSwitchOpen(false)}
        onConfirmHalt={handleConfirmHalt}
        isEngineActive={sniperConfig.autoSnipeEnabled && !engine.isLocalHaltActive()}
        activePositionsCount={positions.length}
      />

      {/* Embedded Wallet Modal */}
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        walletSol={walletSol}
        onAddSol={(amt) => {
          setWalletSol((prev) => prev + amt);
          showToast(`Deposited +${amt} SOL`, `New balance: ${(walletSol + amt).toFixed(2)} SOL`, 'success');
        }}
      />

      {/* Global In-App Toast Notification */}
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-sm glass-panel-elevated rounded-xl p-3 border shadow-2xl animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-1.5 rounded-lg shrink-0 ${
                toastMessage.type === 'success'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 glow-emerald'
                  : toastMessage.type === 'alert'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40 glow-crimson'
                  : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
              }`}
            >
              {toastMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : toastMessage.type === 'alert' ? (
                <AlertOctagon className="w-4 h-4" />
              ) : (
                <BellRing className="w-4 h-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono font-bold text-white truncate">
                {toastMessage.title}
              </div>
              <div className="text-[11px] font-mono text-slate-300 truncate">
                {toastMessage.subtitle}
              </div>
            </div>
          </div>
        </div>
      )}
    </TelegramFrameWrapper>
  );
}
