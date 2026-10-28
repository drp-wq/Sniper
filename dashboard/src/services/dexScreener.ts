/**
 * DexScreener Public API Service
 * Fetches real-time market data, price in USD, and liquidity pools for Solana tokens.
 * Endpoint: GET https://api.dexscreener.com/latest/dex/tokens/{mint}
 */

import { DexQuote } from '../types';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  volume?: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange?: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

export const DexScreenerService = {
  /**
   * Fetch quote for a given mint.
   * Filters strictly for chainId === "solana" and baseToken.address === mint,
   * sorted by highest liquidity.usd (or pinned to preferredPair if active).
   */
  async getQuote(mint: string, preferredPair?: string): Promise<DexQuote | null> {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
    try {
      let data: DexScreenerResponse | null = null;
      const bridge = typeof window !== 'undefined' ? (window as any).AndroidBridge : null;
      if (bridge && typeof bridge.httpRequest === 'function') {
        const rawRes = bridge.httpRequest(url, 'GET', JSON.stringify({ Accept: 'application/json' }), '');
        const parsed = JSON.parse(rawRes);
        if (parsed.ok && parsed.body) {
          data = JSON.parse(parsed.body);
        }
      }
      if (!data) {
        const res = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) {
          return null;
        }
        data = await res.json();
      }
      if (!data || !data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Filter pairs matching Solana network and this mint as baseToken
      const solPairs = data.pairs.filter(
        p => p.chainId === 'solana' && p.baseToken.address.toLowerCase() === mint.toLowerCase()
      );

      if (solPairs.length === 0) {
        return null;
      }

      // Sort by highest liquidity.usd
      solPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      let bestPair = solPairs[0];
      if (preferredPair) {
        const match = solPairs.find(p => p.pairAddress === preferredPair);
        if (match) {
          bestPair = match;
        }
      }

      const priceUsd = parseFloat(bestPair.priceUsd) || 0;
      const liqUsd = bestPair.liquidity?.usd || 0;

      if (priceUsd <= 0) return null;

      return {
        mint,
        symbol: bestPair.baseToken.symbol || 'UNKNOWN',
        name: bestPair.baseToken.name || 'Unknown Token',
        pairAddress: bestPair.pairAddress,
        priceUsd,
        liqUsd,
        volume24h: bestPair.volume?.h24,
        priceChange24h: bestPair.priceChange?.h24,
        dexId: bestPair.dexId,
        updatedAt: Date.now(),
      };
    } catch (err) {
      console.warn(`DexScreener fetch failed for mint ${mint}`, err);
      return null;
    }
  },

  /**
   * Health test to verify DexScreener connection (e.g. Wrapped SOL)
   */
  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = performance.now();
    try {
      const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      const latencyMs = Math.round(performance.now() - start);
      return { ok: res.ok, latencyMs };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      return { ok: false, latencyMs, error: err.message || 'DexScreener unreachable' };
    }
  }
};
