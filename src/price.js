// Free price + liquidity source for the paper phase (DexScreener).
// New pairs can take a short while to be indexed: a null result means "not yet".
export async function getQuote(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const pairs = (j.pairs ?? []).filter((p) => p.chainId === "solana" && Number(p.priceUsd) > 0);
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const p = pairs[0];
    const base = p.baseToken?.address === mint ? p.baseToken : (p.quoteToken?.address === mint ? p.quoteToken : p.baseToken);
    return {
      price: Number(p.priceUsd),
      liqUsd: p.liquidity?.usd ?? 0,
      pair: p.pairAddress,
      symbol: base?.symbol || p.baseToken?.symbol || "UNKNOWN",
      name: base?.name || p.baseToken?.name || "Unknown Token",
    };
  } catch {
    return null;
  }
}
