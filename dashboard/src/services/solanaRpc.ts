/**
 * Solana Read-Only JSON-RPC Client & On-Chain Gate Verifier
 * Strict Token-2022 and Spl-Token safety verification:
 * - Mint authority revoked (must be null)
 * - Freeze authority revoked (must be null)
 * - Is initialized === true
 * - Token-2022 extension blacklists: permanentDelegate, transferHook, transferFeeConfig,
 *   defaultAccountState === "frozen", nonTransferable, mintCloseAuthority, pausableConfig
 * - Top-10 concentration <= 35% (excluding PDA program vaults & AMM pools)
 */

import type { AppConfig, GateVerdict, GateStepResult } from '../types/index.ts';

interface JsonRpcResponse<T> {
  jsonrpc: string;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
  id: number;
}

// Well-known Raydium, Pump.fun, Meteora, Orca program IDs / AMM vaults to exclude from concentration
const KNOWN_AMM_PROGRAMS = new Set([
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM V4
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun Bonding Curve
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora DLMM
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpool
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora Dynamic AMM
]);

// Explicit allowlist of known-handled Token-2022 extensions. Any unknown extension causes the gate to fail-closed.
const KNOWN_HANDLED_EXTENSIONS = new Set([
  // Dangerous extensions handled with specific rule evaluations:
  'permanentDelegate',
  'transferHook',
  'transferFeeConfig',
  'defaultAccountState',
  'nonTransferable',
  'mintCloseAuthority',
  'closeAuthority',
  'pausable',
  'pausableConfig',
  // Benign extensions (metadata / informational pointers that do not restrict transfers):
  'metadataPointer',       // Pointer to metadata account; informational only, no transfer control
  'tokenMetadata',         // Token metadata (name, symbol, uri); informational only
  'groupPointer',          // Pointer to mint group configurations; informational only
  'groupMemberPointer',    // Pointer to group membership; informational only
  'tokenGroup',            // Group structure metadata; informational only
  'tokenGroupMember',      // Group member details; informational only
  'interestBearingConfig', // Display configuration for accrued nominal interest; does not seize, tax, or freeze balances
]);

function hasNonEmptyAuthority(auth: any): boolean {
  if (!auth) return false;
  const s = String(auth).trim();
  return s.length > 0 && s !== '11111111111111111111111111111111';
}

async function callRpc<T>(rpcUrl: string, method: string, params: any[]): Promise<T> {
  const payload = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1000000),
    method,
    params,
  };

  const bodyStr = JSON.stringify(payload);
  const bridge = typeof window !== 'undefined' ? (window as any).AndroidBridge : null;
  if (bridge && typeof bridge.httpRequest === 'function') {
    try {
      const rawRes = bridge.httpRequest(
        rpcUrl,
        'POST',
        JSON.stringify({ 'content-type': 'application/json' }),
        bodyStr
      );
      const parsed = JSON.parse(rawRes);
      if (parsed.ok && parsed.body) {
        const json: JsonRpcResponse<T> = JSON.parse(parsed.body);
        if (json.error) {
          throw new Error(json.error.message || `RPC Error code ${json.error.code}`);
        }
        return json.result as T;
      }
    } catch (bridgeErr: any) {
      if (bridgeErr?.message?.includes('RPC Error')) throw bridgeErr;
    }
  }

  // 1. Direct fetch
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const json: JsonRpcResponse<T> = await res.json();
      if (json.error) {
        throw new Error(json.error.message || `RPC Error code ${json.error.code}`);
      }
      return json.result as T;
    } else {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
  } catch (err: any) {
    // If browser CORS or network failure, fallback to proxy
    try {
      const proxyRes = await fetch('/api/proxy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-target-url': rpcUrl,
        },
        body: JSON.stringify(payload),
      });

      if (proxyRes.ok) {
        const json: JsonRpcResponse<T> = await proxyRes.json();
        if (json.error) {
          throw new Error(json.error.message || `RPC Error code ${json.error.code}`);
        }
        return json.result as T;
      }
    } catch {
      // throw original error below
    }
    throw err;
  }

  throw new Error(`RPC call failed for method ${method}`);
}

export const SolanaRpc = {
  /**
   * Health or Slot check for diagnostics
   */
  async checkHealth(rpcUrl: string): Promise<{ ok: boolean; slot?: number; latencyMs: number; error?: string }> {
    const start = performance.now();
    try {
      const slot = await callRpc<number>(rpcUrl, 'getSlot', []);
      const latencyMs = Math.round(performance.now() - start);
      return { ok: true, slot, latencyMs };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      return { ok: false, latencyMs, error: err.message || 'RPC unreachable' };
    }
  },

  /**
   * Run complete on-chain safety gate for a token mint
   */
  async runOnChainGate(
    config: AppConfig,
    mint: string,
    deps: { callRpc?: <T>(rpcUrl: string, method: string, params: any[]) => Promise<T> } = {}
  ): Promise<GateVerdict> {
    const callRpcFn = deps.callRpc ?? callRpc;
    const steps: GateStepResult[] = [];
    const reasons: string[] = [];
    let passed = true;

    let mintAuthority: string | null = null;
    let freezeAuthority: string | null = null;
    let isToken2022 = false;
    const activeExtensions: string[] = [];
    let totalSupply = 0;
    let top10Pct = 0;
    const top10Wallets: { address: string; pct: number; isVault?: boolean }[] = [];

    // Step 1: getAccountInfo with jsonParsed
    try {
      const accountInfoRes = await callRpcFn<any>(config.rpcUrl, 'getAccountInfo', [
        mint,
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ]);

      if (!accountInfoRes || !accountInfoRes.value) {
        reasons.push('Mint account does not exist or has 0 lamports');
        steps.push({
          step: 'Account Info',
          passed: false,
          detail: 'Mint address not found on Solana mainnet',
        });
        return {
          mint,
          passed: false,
          reasons,
          steps,
          checkedAt: Date.now(),
        };
      }

      const parsedData = accountInfoRes.value.data?.parsed;
      const ownerProgram = accountInfoRes.value.owner;
      isToken2022 = ownerProgram === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

      if (!parsedData || parsedData.type !== 'mint') {
        reasons.push(`Account is not a SPL mint (owner: ${ownerProgram})`);
        steps.push({
          step: 'Account Type',
          passed: false,
          detail: `Type is ${parsedData?.type || 'unknown'}`,
        });
        return {
          mint,
          passed: false,
          reasons,
          steps,
          checkedAt: Date.now(),
        };
      }

      const info = parsedData.info || {};
      mintAuthority = info.mintAuthority || null;
      freezeAuthority = info.freezeAuthority || null;
      const isInitialized = info.isInitialized !== false;

      // Rule: Reject if mintAuthority !== null
      if (mintAuthority !== null) {
        passed = false;
        reasons.push(`Mint authority active (${mintAuthority.slice(0, 4)}...${mintAuthority.slice(-4)})`);
        steps.push({
          step: 'Mint Authority',
          passed: false,
          detail: `Active mint authority: ${mintAuthority}`,
        });
      } else {
        steps.push({
          step: 'Mint Authority',
          passed: true,
          detail: 'Revoked (null)',
        });
      }

      // Rule: Reject if freezeAuthority !== null
      if (freezeAuthority !== null) {
        passed = false;
        reasons.push(`Freeze authority active (${freezeAuthority.slice(0, 4)}...${freezeAuthority.slice(-4)})`);
        steps.push({
          step: 'Freeze Authority',
          passed: false,
          detail: `Active freeze authority: ${freezeAuthority}`,
        });
      } else {
        steps.push({
          step: 'Freeze Authority',
          passed: true,
          detail: 'Revoked (null)',
        });
      }

      // Rule: Reject if isInitialized === false
      if (!isInitialized) {
        passed = false;
        reasons.push('Token mint is not initialized');
        steps.push({
          step: 'Initialization',
          passed: false,
          detail: 'isInitialized is false',
        });
      }

      // Inspect Token-2022 extensions if present
      if (info.extensions && Array.isArray(info.extensions)) {
        for (const ext of info.extensions) {
          const extType = typeof ext?.extension === 'string' ? ext.extension.trim() : '';
          activeExtensions.push(extType);

          // Fail-closed on unknown / unhandled Token-2022 extension types
          if (!KNOWN_HANDLED_EXTENSIONS.has(extType)) {
            passed = false;
            reasons.push(`Token-2022 unknown/unhandled extension: ${extType}`);
            continue;
          }

          if (extType === 'permanentDelegate' && hasNonEmptyAuthority(ext.state?.delegate)) {
            passed = false;
            reasons.push('Token-2022 permanent delegate extension active (can seize tokens)');
          } else if (
            extType === 'transferHook' &&
            (hasNonEmptyAuthority(ext.state?.programId) || hasNonEmptyAuthority(ext.state?.authority))
          ) {
            passed = false;
            reasons.push('Token-2022 transfer hook active (can block or tax transfers)');
          } else if (extType === 'transferFeeConfig') {
            const olderBps = Number(ext.state?.olderTransferFee?.transferFeeBasisPoints ?? 0);
            const newerBps = Number(ext.state?.newerTransferFee?.transferFeeBasisPoints ?? ext.state?.transferFeeBasisPoints ?? 0);
            if (
              (Number.isFinite(olderBps) && olderBps > 0) ||
              (Number.isFinite(newerBps) && newerBps > 0) ||
              hasNonEmptyAuthority(ext.state?.transferFeeConfigAuthority) ||
              hasNonEmptyAuthority(ext.state?.withdrawWithheldAuthority)
            ) {
              passed = false;
              reasons.push(`Token-2022 transfer fee active (${newerBps || olderBps} bps / authority active)`);
            }
          } else if (extType === 'defaultAccountState') {
            const acctState = String(ext.state?.state ?? ext.state?.accountState ?? '').trim().toLowerCase();
            if (acctState === 'frozen' || acctState === '2') {
              passed = false;
              reasons.push('Token-2022 default account state is frozen');
            }
          } else if (extType === 'nonTransferable') {
            passed = false;
            reasons.push('Token-2022 non-transferable extension active (soulbound)');
          } else if (
            (extType === 'mintCloseAuthority' || extType === 'closeAuthority') &&
            hasNonEmptyAuthority(ext.state?.closeAuthority)
          ) {
            passed = false;
            reasons.push('Token-2022 mint close authority active');
          } else if (
            (extType === 'pausable' || extType === 'pausableConfig') &&
            (Boolean(ext.state?.paused) || hasNonEmptyAuthority(ext.state?.authority))
          ) {
            passed = false;
            reasons.push('Token-2022 pausable configuration active');
          }
        }

        steps.push({
          step: 'Token-2022 Extensions',
          passed: reasons.filter(r => r.includes('Token-2022')).length === 0,
          detail: activeExtensions.length > 0 ? activeExtensions.join(', ') : 'None',
        });
      }
    } catch (err: any) {
      passed = false;
      reasons.push(`Account info query failed: ${err.message || 'RPC error'}`);
      steps.push({
        step: 'Account Info RPC',
        passed: false,
        detail: err.message || 'RPC failure',
      });
      return {
        mint,
        passed: false,
        reasons,
        steps,
        checkedAt: Date.now(),
      };
    }

    // Step 2: Supply & Top Wallets Concentration Gate
    try {
      // 2a. Supply
      const supplyRes = await callRpcFn<any>(config.rpcUrl, 'getTokenSupply', [mint, { commitment: 'confirmed' }]);
      const rawSupply = supplyRes?.value?.amount;
      const decimals = supplyRes?.value?.decimals ?? 6;
      totalSupply = parseFloat(rawSupply) / Math.pow(10, decimals);

      if (!totalSupply || totalSupply <= 0) {
        passed = false;
        reasons.push('Token supply is 0 or unreadable');
        steps.push({
          step: 'Token Supply',
          passed: false,
          detail: 'Supply is 0',
        });
      } else {
        steps.push({
          step: 'Token Supply',
          passed: true,
          detail: `${totalSupply.toLocaleString()} (decimals: ${decimals})`,
        });
      }

      // 2b. Largest Accounts
      const largestRes = await callRpcFn<any>(config.rpcUrl, 'getTokenLargestAccounts', [
        mint,
        { commitment: 'confirmed' },
      ]);
      const largestList: { address: string; amount: string; decimals: number }[] = (largestRes?.value || []).slice(0, 20);

      if (largestList.length === 0) {
        throw new Error('No largest-account data');
      }

      if (totalSupply > 0) {
        // Query token accounts to find parsed owner pubkeys
        const pubkeys = largestList.map(a => a.address);
        const multiRes = await callRpcFn<any>(config.rpcUrl, 'getMultipleAccounts', [
          pubkeys,
          { encoding: 'jsonParsed', commitment: 'confirmed' },
        ]);
        const accounts = multiRes?.value || [];

        const owners = accounts.map((a: any) => {
          return a?.data?.parsed?.info?.owner || null;
        });

        if (owners.length === 0 || owners.some((o: any) => !o)) {
          throw new Error('Unparseable holder owner');
        }

        const ownerKeys: string[] = Array.from(new Set(owners as string[]));

        // Query owner account program owners to distinguish system wallets from program PDAs / vaults
        const ownerInfoRes = ownerKeys.length > 0
          ? await callRpcFn<any>(config.rpcUrl, 'getMultipleAccounts', [
              ownerKeys,
              { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, commitment: 'confirmed' },
            ])
          : { value: [] };
        const ownerInfo = ownerInfoRes?.value || [];

        // F4 owner decision: only exclude holders whose owner is in KNOWN_AMM_PROGRAMS or whose owner account is owned by a KNOWN_AMM program; other non-system-owned holders count toward concentration.
        const isExcluded = new Map<string, boolean>(
          ownerKeys.map((k, idx) => {
            if (KNOWN_AMM_PROGRAMS.has(k)) return [k, true];
            const acct = ownerInfo[idx];
            if (acct && KNOWN_AMM_PROGRAMS.has(acct.owner)) {
              return [k, true];
            }
            return [k, false];
          })
        );

        const walletBalances: Map<string, number> = new Map();
        for (let i = 0; i < largestList.length; i++) {
          const item = largestList[i];
          const owner = owners[i];
          if (!owner || isExcluded.get(owner) === true) {
            continue; // Exclude AMM vaults and liquidity pools
          }
          const itemBal = parseFloat(item.amount) / Math.pow(10, item.decimals || decimals);
          if (Number.isFinite(itemBal) && itemBal > 0) {
            const current = walletBalances.get(owner) || 0;
            walletBalances.set(owner, current + itemBal);
          }
        }

        // Sort descending by balance
        const sortedWallets = Array.from(walletBalances.entries())
          .map(([addr, bal]) => ({
            address: addr,
            pct: (bal / totalSupply) * 100,
          }))
          .sort((a, b) => b.pct - a.pct);

        // Sum top 10 non-vault wallets
        const top10 = sortedWallets.slice(0, 10);
        top10Pct = top10.reduce((acc, w) => acc + w.pct, 0);
        top10Wallets.push(...top10);

        if (top10Pct > config.maxTop10Pct) {
          passed = false;
          reasons.push(
            `Top 10 wallets hold ${top10Pct.toFixed(1)}% of supply (exceeds ${config.maxTop10Pct}% max allowed)`
          );
          steps.push({
            step: 'Holder Concentration',
            passed: false,
            detail: `Top-10 hold ${top10Pct.toFixed(1)}% (> ${config.maxTop10Pct}%)`,
          });
        } else {
          steps.push({
            step: 'Holder Concentration',
            passed: true,
            detail: `Top-10 hold ${top10Pct.toFixed(1)}% (<= ${config.maxTop10Pct}%)`,
          });
        }
      }
    } catch (err: any) {
      // If RPC failed for largest accounts, record warning / reject
      passed = false;
      reasons.push(`Holder analysis failed: ${err.message || 'RPC rate limit'}`);
      steps.push({
        step: 'Holder Concentration RPC',
        passed: false,
        detail: err.message || 'RPC failure',
      });
    }

    return {
      mint,
      passed,
      reasons,
      steps,
      supply: totalSupply,
      top10Pct,
      top10Wallets,
      isToken2022,
      activeExtensions,
      mintAuthority,
      freezeAuthority,
      checkedAt: Date.now(),
    };
  },
};
