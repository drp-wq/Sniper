import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Code2,
  PieChart,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Zap
} from 'lucide-react';
import { SafetyAuditResult } from '../types';
import { auditTokenMint, TEST_VECTORS, TestVector } from '../services/coinGate';
import { haptics } from '../services/haptics';

interface SafetyGateInspectorProps {
  initialMint?: string;
  onQuickSnipe?: (mint: string, symbol: string) => void;
}

export const SafetyGateInspector: React.FC<SafetyGateInspectorProps> = ({
  initialMint,
  onQuickSnipe
}) => {
  const [inputAddress, setInputAddress] = useState(
    initialMint || 'Cat9ZpC4gTfRsm12wYFvMvK8xQyW3mK9jD2pE5qR8sT1'
  );
  const [auditResult, setAuditResult] = useState<SafetyAuditResult>(() =>
    auditTokenMint(initialMint || 'Cat9ZpC4gTfRsm12wYFvMvK8xQyW3mK9jD2pE5qR8sT1')
  );
  const [isAuditing, setIsAuditing] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<number>(6);
  const [activeTab, setActiveTab] = useState<'inspector' | 'audit_lab'>('inspector');

  const runAuditAnimation = (targetInput: string) => {
    setIsAuditing(true);
    setCompletedSteps(0);
    haptics.selection();

    // Sequence through the 5 on-chain safety gates with animated verification steps
    const timer1 = setTimeout(() => {
      setCompletedSteps(1);
      haptics.light();
    }, 200);

    const timer2 = setTimeout(() => {
      setCompletedSteps(2);
      haptics.light();
    }, 450);

    const timer3 = setTimeout(() => {
      setCompletedSteps(3);
      haptics.light();
    }, 700);

    const timer4 = setTimeout(() => {
      setCompletedSteps(4);
      haptics.light();
    }, 950);

    const timer5 = setTimeout(() => {
      setCompletedSteps(5);
      haptics.light();
    }, 1200);

    const timer6 = setTimeout(() => {
      const result = auditTokenMint(targetInput);
      setAuditResult(result);
      setCompletedSteps(6);
      setIsAuditing(false);
      if (result.status === 'PASSED') {
        haptics.success();
      } else {
        haptics.error();
      }
    }, 1450);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
      clearTimeout(timer5);
      clearTimeout(timer6);
    };
  };

  const handleSelectTestVector = (vector: TestVector) => {
    setInputAddress(vector.input);
    runAuditAnimation(vector.input);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputAddress.trim()) return;
    runAuditAnimation(inputAddress);
  };

  // Color logic for score
  const getScoreColor = (score: number) => {
    if (score >= 90) return { text: 'text-emerald-400', stroke: '#10B981', glow: 'glow-emerald' };
    if (score >= 70) return { text: 'text-cyan-400', stroke: '#06B6D4', glow: 'glow-cyan' };
    if (score >= 50) return { text: 'text-amber-400', stroke: '#F59E0B', glow: '' };
    return { text: 'text-red-400', stroke: '#EF4444', glow: 'glow-crimson' };
  };

  const scoreTheme = getScoreColor(auditResult.safetyScore);

  return (
    <div className="space-y-4 pb-24">
      
      {/* Top Segmented Navigation: Gate Inspector vs Audit Lab */}
      <div className="flex items-center justify-between p-1 bg-slate-900/80 rounded-xl border border-white/8">
        <button
          onClick={() => {
            haptics.selection();
            setActiveTab('inspector');
          }}
          className={`flex-1 py-2 text-xs font-mono font-semibold rounded-lg transition-all ${
            activeTab === 'inspector'
              ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Safety Gate Inspector
        </button>
        <button
          onClick={() => {
            haptics.selection();
            setActiveTab('audit_lab');
          }}
          className={`flex-1 py-2 text-xs font-mono font-semibold rounded-lg transition-all ${
            activeTab === 'audit_lab'
              ? 'bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Coin Gate Audit Lab (4 Vulnerabilities)
        </button>
      </div>

      {/* Address Search & Quick Test Vector Row */}
      <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
        <form onSubmit={handleSubmit} className="relative">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={inputAddress}
              onChange={(e) => setInputAddress(e.target.value)}
              placeholder="Paste Solana CA, Pair, or Solscan URL..."
              className="w-full pl-9 pr-24 py-2.5 bg-slate-950/70 border border-white/10 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 transition-all"
            />
            <button
              type="submit"
              disabled={isAuditing}
              className="absolute right-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 shadow-md shadow-emerald-500/20"
            >
              {isAuditing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Auditing</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Audit</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Quick Test Vectors Chips */}
        <div>
          <div className="text-[10px] font-mono uppercase text-slate-400 tracking-wider mb-1.5">
            Quick Audit Test Vectors (Vulnerability Benchmarks):
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {TEST_VECTORS.map((vec) => (
              <button
                key={vec.id}
                onClick={() => handleSelectTestVector(vec)}
                className={`px-2 py-1 rounded-md text-[10px] font-mono whitespace-nowrap border transition-all active:scale-95 ${
                  inputAddress === vec.input
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : vec.category === 'Account Spoof Exploit' || vec.category === 'Honeypot Tax'
                    ? 'bg-red-950/30 border-red-500/30 text-red-300 hover:bg-red-900/40'
                    : 'bg-slate-900/60 border-white/8 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {vec.name.split(' (')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 'inspector' ? (
        <>
          {/* Hexagonal / Shield Security Score Gauge Card */}
          <div className="glass-panel-elevated rounded-2xl p-5 border border-white/10 relative overflow-hidden">
            {/* Background subtle neon radial aura */}
            <div
              className="absolute -right-16 -top-16 w-48 h-48 rounded-full blur-3xl opacity-20 pointer-events-none"
              style={{ background: scoreTheme.stroke }}
            />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
              {/* Animated Gauge SVG */}
              <div className="relative flex items-center justify-center shrink-0">
                <svg className="w-32 h-32 transform -rotate-90">
                  {/* Background Track */}
                  <circle
                    cx="64"
                    cy="64"
                    r="54"
                    stroke="rgba(255, 255, 255, 0.08)"
                    strokeWidth="10"
                    fill="transparent"
                  />
                  {/* Hexagon/Circle Score Arc */}
                  <circle
                    cx="64"
                    cy="64"
                    r="54"
                    stroke={scoreTheme.stroke}
                    strokeWidth="10"
                    strokeDasharray={2 * Math.PI * 54}
                    strokeDashoffset={
                      isAuditing
                        ? 2 * Math.PI * 54 * (1 - (completedSteps / 6))
                        : 2 * Math.PI * 54 * (1 - (auditResult.safetyScore / 100))
                    }
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>

                {/* Score Number Inside Gauge */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className={`text-3xl font-extrabold font-mono tabular-nums leading-none ${scoreTheme.text}`}>
                    {isAuditing ? Math.round((completedSteps / 6) * 100) : auditResult.safetyScore}
                    <span className="text-sm font-normal text-slate-400">%</span>
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mt-1">
                    Safety Score
                  </span>
                </div>
              </div>

              {/* Token Verdict & Overview */}
              <div className="flex-1 text-center sm:text-left space-y-2">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <span className="text-lg font-bold text-white font-mono">
                    ${auditResult.symbol}
                  </span>
                  <span className="text-xs text-slate-400">· {auditResult.name}</span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                      auditResult.status === 'PASSED'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : 'bg-red-500/20 text-red-400 border border-red-500/40'
                    }`}
                  >
                    {auditResult.status}
                  </span>
                </div>

                <div className="text-xs font-mono text-slate-400 truncate max-w-sm">
                  Mint: <span className="text-slate-200">{auditResult.resolvedMint}</span>
                </div>

                {auditResult.vulnerabilityAnalysis.dexPairFallbackResolved && (
                  <div className="text-[11px] text-cyan-400 font-mono flex items-center gap-1 justify-center sm:justify-start">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolved Pair Address to Base Mint automatically
                  </div>
                )}

                {/* Action Trigger */}
                {auditResult.status === 'PASSED' && onQuickSnipe && (
                  <div className="pt-1">
                    <button
                      onClick={() => {
                        haptics.heavy();
                        onQuickSnipe(auditResult.resolvedMint, auditResult.symbol);
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-500/25 glow-emerald"
                    >
                      <Zap className="w-4 h-4" />
                      <span>Snipe {auditResult.symbol} (0.5 SOL)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stepper Checklist: On-Chain Verification Pipeline */}
          <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>On-Chain Security Invariant Checks</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {isAuditing ? `${completedSteps}/6 Completed` : 'All Gates Evaluated'}
              </span>
            </div>

            <div className="space-y-2">
              {auditResult.checks.map((check, index) => {
                const isStepFinished = !isAuditing || completedSteps > index;
                const isCurrentProcessing = isAuditing && completedSteps === index;

                return (
                  <div
                    key={check.id}
                    className={`p-3 rounded-xl border transition-all ${
                      !isStepFinished
                        ? 'bg-slate-950/40 border-white/5 opacity-50'
                        : check.passed
                        ? 'bg-emerald-950/20 border-emerald-500/20 text-slate-200'
                        : 'bg-red-950/20 border-red-500/30 text-slate-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5 shrink-0">
                          {isCurrentProcessing ? (
                            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                          ) : !isStepFinished ? (
                            <div className="w-4 h-4 rounded-full border border-slate-600" />
                          ) : check.passed ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 glow-emerald" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 glow-crimson" />
                          )}
                        </div>

                        <div>
                          <div className="text-xs font-bold font-mono flex items-center gap-2">
                            {check.label}
                            {check.critical && (
                              <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400 border border-white/5">
                                Critical
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                            {check.description}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            !isStepFinished
                              ? 'text-slate-500'
                              : check.passed
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : 'text-red-400 bg-red-500/10'
                          }`}
                        >
                          {!isStepFinished ? 'PENDING' : check.passed ? 'PASSED' : 'FLAGGED'}
                        </span>
                      </div>
                    </div>

                    {isStepFinished && (
                      <div className="mt-2 pt-2 border-t border-white/5 text-[11px] font-mono text-slate-400">
                        {check.details}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Holder Donut & Liquidity Lock Analysis */}
          <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold flex items-center gap-1.5">
                <PieChart className="w-4 h-4 text-cyan-400" />
                <span>Holder Donut & Concentration</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400">Top 10 Wallets</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              {/* Visual Mini Donut */}
              <div className="flex items-center justify-center py-2">
                <div className="relative w-28 h-28">
                  <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                    {/* Background */}
                    <circle cx="18" cy="18" r="14" fill="none" stroke="#1E293B" strokeWidth="6" />
                    {/* Segments */}
                    {auditResult.holderDistribution.map((item, idx) => {
                      const prevPercents = auditResult.holderDistribution
                        .slice(0, idx)
                        .reduce((acc, cur) => acc + cur.percent, 0);
                      const circumference = 2 * Math.PI * 14;
                      const strokeDasharray = `${(item.percent / 100) * circumference} ${circumference}`;
                      const strokeDashoffset = -((prevPercents / 100) * circumference);

                      return (
                        <circle
                          key={item.label}
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke={item.color}
                          strokeWidth="6"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          className="transition-all duration-500"
                        />
                      );
                    })}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-mono text-slate-300 font-bold">Holders</span>
                  </div>
                </div>
              </div>

              {/* Legend List */}
              <div className="space-y-1.5">
                {auditResult.holderDistribution.map((holder) => (
                  <div key={holder.label} className="flex items-center justify-between text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: holder.color }} />
                      <span className="text-slate-300 text-[11px]">{holder.label}</span>
                    </div>
                    <span className="text-white font-bold tabular-nums">{holder.percent}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Coin Gate Audit Lab (The 4 Vulnerabilities Detailed Breakdown) */
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 space-y-2">
            <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold text-xs uppercase">
              <Code2 className="w-4 h-4" />
              <span>Coin Gate Safety Engine Audit Report</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Below is the comprehensive architectural breakdown of the 4 critical vulnerabilities discovered in <code className="text-cyan-300 font-mono">gate.js</code> and <code className="text-cyan-300 font-mono">solanaRpc.ts</code>, and their verified production fixes.
            </p>
          </div>

          {/* Vulnerability 1: The Info Object Misclassification */}
          <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-red-400 font-mono px-2 py-0.5 rounded bg-red-950/50 border border-red-500/30">
                  ISSUE #1 · CRITICAL (P0)
                </span>
                <span className="text-xs font-bold text-white font-mono">
                  The "Info" Object Misclassification
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">gate.js:109</span>
            </div>
            
            <p className="text-xs text-slate-400">
              <strong className="text-slate-200">Vulnerability:</strong> Token accounts (<code className="text-red-300 font-mono">parsed.type === "account"</code>) were mistakenly parsed as valid mints. Because SPL token accounts have no <code className="text-red-300 font-mono">mintAuthority</code> or <code className="text-red-300 font-mono">freezeAuthority</code>, naive sniper bots evaluated them as "Authority Revoked" and sniped fake contracts!
            </p>

            <div className="p-3 bg-slate-950 rounded-xl border border-white/8 font-mono text-[11px] text-slate-300 overflow-x-auto">
              <div className="text-emerald-400 font-semibold mb-1">// Solution Implemented: Strict isMintParsed()</div>
              <pre>{`function isMintParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.type === "mint") return true;
  if (parsed.type === "account") return false; // REJECT TOKEN ACCOUNTS!
  const info = parsed.info || parsed;
  return (
    info &&
    typeof info === "object" &&
    !info.tokenAmount && // Token accounts contain tokenAmount
    (info.mintAuthority !== undefined ||
      info.freezeAuthority !== undefined ||
      info.supply !== undefined ||
      (info.decimals !== undefined && !info.owner))
  );
}`}</pre>
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono pt-1">
              <span className="text-slate-400">Test Vector:</span>
              <button
                onClick={() => handleSelectTestVector(TEST_VECTORS[1])}
                className="text-cyan-400 hover:underline flex items-center gap-1"
              >
                <span>Run Account Spoof Test Vector</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Vulnerability 2: Unsafe Property Access */}
          <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-400 font-mono px-2 py-0.5 rounded bg-amber-950/50 border border-amber-500/30">
                  ISSUE #2 · HIGH (P1)
                </span>
                <span className="text-xs font-bold text-white font-mono">
                  Unsafe Property Access & Crashes
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">solanaRpc.ts:458</span>
            </div>

            <p className="text-xs text-slate-400">
              <strong className="text-slate-200">Vulnerability:</strong> Accessing <code className="text-amber-300 font-mono">info.supply</code> directly without optional chaining caused unhandled ReferenceErrors/TypeErrors when <code className="text-amber-300 font-mono">info</code> was null, crashing the sniper daemon.
            </p>

            <div className="p-3 bg-slate-950 rounded-xl border border-white/8 font-mono text-[11px] text-slate-300 overflow-x-auto">
              <div className="text-emerald-400 font-semibold mb-1">// Solution Implemented: Optional Chaining & Fallbacks</div>
              <pre>{`const supply = info?.supply ?? '0';
const decimals = info?.decimals ?? 9;
const mintAuth = info?.mintAuthority ?? null;`}</pre>
            </div>
          </div>

          {/* Vulnerability 3: Address Sanitization */}
          <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-400 font-mono px-2 py-0.5 rounded bg-blue-950/50 border border-blue-500/30">
                  ISSUE #3 · MEDIUM (P2)
                </span>
                <span className="text-xs font-bold text-white font-mono">
                  Address Sanitization Inconsistency
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">gate.js:129</span>
            </div>

            <p className="text-xs text-slate-400">
              <strong className="text-slate-200">Vulnerability:</strong> <code className="text-blue-300 font-mono">cleanMint</code> was used only for <code className="text-blue-300 font-mono">getAccountInfo</code>, while dirty addresses were passed to <code className="text-blue-300 font-mono">getTokenSupply</code> and <code className="text-blue-300 font-mono">getTokenLargestAccounts</code>, failing on spaces or URLs.
            </p>
          </div>

          {/* Vulnerability 4: DEX Pair Fallback */}
          <div className="glass-panel rounded-2xl p-4 border border-white/8 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-400 font-mono px-2 py-0.5 rounded bg-emerald-950/50 border border-emerald-500/30">
                  ISSUE #4 · MEDIUM (P2)
                </span>
                <span className="text-xs font-bold text-white font-mono">
                  Pair/DEX Address Fallback
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">gate.js:110</span>
            </div>

            <p className="text-xs text-slate-400">
              <strong className="text-slate-200">Vulnerability:</strong> Passing Raydium or Orca LP pair addresses rejected tokens outright on backend <code className="text-emerald-300 font-mono">runGate</code>, whereas frontend resolved them via DexScreener. SolRelay now automatically resolves pool addresses to base mints before evaluation.
            </p>
          </div>
        </div>
      )}

    </div>
  );
};
