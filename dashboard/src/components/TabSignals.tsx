/**
 * Tab 3: Live Signal & Gate Feed
 * Real-time signal stream with latency, exact on-chain gate verdicts & rejection reasons,
 * status filters, and interactive on-demand "Test Mint Gate" inspector & simulator.
 */

import React, { useState } from 'react';
import {
  Radio,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  Zap,
  Activity,
  Layers,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { engine } from '../services/engine';
import { SolanaRpc } from '../services/solanaRpc';
import { DexScreenerService } from '../services/dexScreener';
import { SAMPLE_TEST_MINTS } from '../services/sampleData';
import { GateVerdict, DexQuote } from '../types';

export const TabSignals: React.FC = () => {
  const signalLogs = engine.getSignalLogs();
  const config = engine.getConfig();

  // Test Mint Gate Inspector State
  const [testMintInput, setTestMintInput] = useState('');
  const [isTestingMint, setIsTestingMint] = useState(false);
  const [testVerdict, setTestVerdict] = useState<GateVerdict | null>(null);
  const [testQuote, setTestQuote] = useState<DexQuote | null>(null);
  const [copiedMint, setCopiedMint] = useState<string | null>(null);

  // Stream filter state
  const [statusFilter, setStatusFilter] = useState<'all' | 'entered' | 'rejected' | 'skipped'>('all');
  const [streamSearch, setStreamSearch] = useState('');

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMint(text);
    setTimeout(() => setCopiedMint(null), 2000);
  };

  const handleRunManualGate = async (targetMint?: string) => {
    const mint = (targetMint || testMintInput).trim();
    if (!mint) return;
    setIsTestingMint(true);
    setTestVerdict(null);
    setTestQuote(null);

    try {
      // 1. Run On-Chain Gate
      const verdict = await SolanaRpc.runOnChainGate(config, mint);
      setTestVerdict(verdict);

      // 2. Run DexScreener Quote & Liquidity check
      const quote = await DexScreenerService.getQuote(mint);
      setTestQuote(quote);
    } catch (e) {
      console.error('Manual gate check failed', e);
    } finally {
      setIsTestingMint(false);
    }
  };

  const handleSimulateSignal = async (presetMint?: string) => {
    await engine.simulateSignal(presetMint);
  };

  // Filter signal logs
  const filteredLogs = signalLogs.filter(log => {
    const matchesStatus = statusFilter === 'all' || log.status === statusFilter;
    const matchesSearch =
      streamSearch === '' ||
      log.mint.toLowerCase().includes(streamSearch.toLowerCase()) ||
      (log.quote?.symbol && log.quote.symbol.toLowerCase().includes(streamSearch.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-4 pb-20">
      
      {/* Interactive "Test Mint Gate" Inspector */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 font-mono">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-sm text-white">Manual Token Gate Inspector</span>
          </div>
          <span className="text-[10px] text-zinc-500">Live Solana Mainnet RPC</span>
        </div>

        <p className="text-xs text-zinc-400 mb-3">
          Paste any Solana mint address to execute the full on-chain gate (Token-2022 extensions, mint/freeze authorities, top-10 concentration) and DexScreener liquidity quote.
        </p>

        {/* Input & Action */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={testMintInput}
              onChange={e => setTestMintInput(e.target.value)}
              placeholder="Enter Solana Mint Pubkey (e.g. So11111111111111111111111111111111111111112)"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
          <button
            onClick={() => handleRunManualGate()}
            disabled={isTestingMint || !testMintInput.trim()}
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold text-xs transition-colors cursor-pointer"
          >
            {isTestingMint ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                <span>Auditing...</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Audit Mint Gate</span>
              </>
            )}
          </button>
        </div>

        {/* Preset Samples */}
        <div className="mt-3 flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-zinc-500">Test Presets:</span>
          {SAMPLE_TEST_MINTS.map(sample => (
            <button
              key={sample.mint}
              onClick={() => {
                setTestMintInput(sample.mint);
                handleRunManualGate(sample.mint);
              }}
              className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer"
            >
              {sample.name}
            </button>
          ))}
        </div>

        {/* Inspector Result Breakdown */}
        {testVerdict && (
          <div className="mt-4 p-3.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">Audit Verdict:</span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded ${
                    testVerdict.passed && (testQuote?.liqUsd || 0) >= config.minLiqUsd
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-red-500/20 text-red-400 border border-red-500/40'
                  }`}
                >
                  {testVerdict.passed && (testQuote?.liqUsd || 0) >= config.minLiqUsd
                    ? 'PASSED ALL SAFETY GATES'
                    : 'REJECTED BY GATES'}
                </span>
              </div>
              <span className="text-[10px] text-zinc-500">
                Audited at {new Date(testVerdict.checkedAt).toLocaleTimeString()}
              </span>
            </div>

            {/* Step-by-step checks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {testVerdict.steps.map((st, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded bg-zinc-950/60 border border-zinc-800/80"
                >
                  {st.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-semibold text-zinc-200">{st.step}</div>
                    <div className="text-[11px] text-zinc-400">{st.detail}</div>
                  </div>
                </div>
              ))}

              {/* DexScreener Liquidity Gate Step */}
              <div className="flex items-start gap-2 p-2 rounded bg-zinc-950/60 border border-zinc-800/80">
                {testQuote && testQuote.liqUsd >= config.minLiqUsd ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold text-zinc-200">DexScreener Liquidity Gate</div>
                  <div className="text-[11px] text-zinc-400">
                    {testQuote
                      ? `$${Math.round(testQuote.liqUsd).toLocaleString()} (Required: >= $${config.minLiqUsd.toLocaleString()})`
                      : 'No liquidity quote pair found on Solana'}
                  </div>
                </div>
              </div>
            </div>

            {/* Rejection reasons if failed */}
            {testVerdict.reasons.length > 0 && (
              <div className="p-2.5 rounded bg-red-950/30 border border-red-900/50 text-red-300 text-xs">
                <div className="font-bold mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Failure Triggers:</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  {testVerdict.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Token Quote Details */}
            {testQuote && (
              <div className="p-2.5 rounded bg-zinc-950/80 border border-zinc-800 text-[11px] flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="font-bold text-white">{testQuote.name} ({testQuote.symbol})</span>
                  <span className="text-zinc-500 ml-2">Dex: {testQuote.dexId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>Price: <strong className="text-white">${testQuote.priceUsd.toFixed(6)}</strong></span>
                  <span>Liq: <strong className="text-emerald-400">${Math.round(testQuote.liqUsd).toLocaleString()}</strong></span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Real-time Signal Stream Section */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 font-mono">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="font-bold text-sm text-white">Live Signal & Gate Stream</span>
            <span className="text-xs text-zinc-500">({filteredLogs.length} shown)</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleSimulateSignal()}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 text-xs cursor-pointer font-bold transition-colors"
              title="Inject a mock signal to test live on-chain gate audit"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Simulate Signal</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mb-3 pt-2 border-t border-zinc-800/80 text-xs">
          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={streamSearch}
              onChange={e => setStreamSearch(e.target.value)}
              placeholder="Search stream by mint or symbol..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-white text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 w-full sm:w-auto overflow-x-auto text-[11px]">
            <span className="text-zinc-500 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Status:
            </span>
            {(['all', 'entered', 'rejected', 'skipped'] as const).map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2 py-1 rounded capitalize cursor-pointer transition-colors ${
                  statusFilter === st
                    ? 'bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30'
                    : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-xs">
            <Radio className="w-8 h-8 mx-auto mb-2 text-zinc-600 animate-pulse" />
            <div>Listening to Worker `/signals?since=cursor`...</div>
            <div className="mt-1 text-zinc-600 text-[11px]">
              Signals pushed to Cloudflare Worker `SignalQueueDO` will appear here in real-time.
            </div>
            <button
              onClick={() => handleSimulateSignal()}
              className="mt-3 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-zinc-700 text-xs inline-flex items-center gap-1 cursor-pointer"
            >
              <Zap className="w-3 h-3" />
              <span>Inject Test Signal Now</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredLogs.map(log => {
              const isEntered = log.status === 'entered';
              const isRejected = log.status === 'rejected';

              return (
                <div
                  key={log.id}
                  className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white">Signal #{log.signalId}</span>
                      <span className="text-zinc-400">
                        {log.mint.slice(0, 6)}...{log.mint.slice(-6)}
                      </span>
                      <button
                        onClick={() => handleCopy(log.mint)}
                        className="hover:text-white text-zinc-500 cursor-pointer"
                        title="Copy mint"
                      >
                        {copiedMint === log.mint ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>

                      {log.sig && (
                        <a
                          href={`https://solscan.io/tx/${log.sig}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-zinc-500 hover:text-purple-400 flex items-center gap-0.5"
                        >
                          Tx <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500">
                        Relay lag: {log.latencyMs}ms
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                          isEntered
                            ? 'bg-emerald-500 text-black'
                            : isRejected
                            ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {log.status.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Verdict & Rejection Details */}
                  {log.rejectionReasons && log.rejectionReasons.length > 0 && (
                    <div className="text-[11px] text-red-400/90 bg-red-950/20 p-2 rounded border border-red-900/30">
                      <strong>Rejection Reasons:</strong> {log.rejectionReasons.join(' • ')}
                    </div>
                  )}

                  {log.skipReason && (
                    <div className="text-[11px] text-zinc-400">
                      Skip Reason: <span className="text-amber-400">{log.skipReason}</span>
                    </div>
                  )}

                  {/* Quote info if entered */}
                  {log.quote && (
                    <div className="mt-1.5 text-[11px] text-emerald-400/90 flex items-center gap-3">
                      <span>Symbol: <strong>{log.quote.symbol}</strong></span>
                      <span>•</span>
                      <span>Quote: ${log.quote.priceUsd.toFixed(6)}</span>
                      <span>•</span>
                      <span>Liq: ${Math.round(log.quote.liqUsd).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
