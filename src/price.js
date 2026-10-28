// Free price + liquidity source for the paper phase (DexScreener).
// New pairs can take a short while to be indexed: a null result means "not yet".

export function selectPair(pairs, preferredPair = null, opts = {}) {
  const targetMint =
    typeof opts?.mint === "string" && opts.mint.trim().length > 0 ? opts.mint.trim() : null;
  const valid = (Array.isArray(pairs) ? pairs : []).filter((p) => {
    if (
      !p ||
      p.chainId !== "solana" ||
      !Number.isFinite(Number(p.priceUsd)) ||
      Number(p.priceUsd) <= 0 ||
      !Number.isFinite(Number(p.liquidity?.usd ?? 0)) ||
      Number(p.liquidity?.usd ?? 0) < 0
    ) {
      return false;
    }
    // DexScreener priceUsd is always denominated in the pair's baseToken.
    // When baseToken.address is present and targetMint is specified, reject inverted pairs
    // where targetMint is only the quoteToken.
    const baseAddr =
      typeof p.baseToken?.address === "string" ? p.baseToken.address.trim() : "";
    if (targetMint && baseAddr !== targetMint) {
      return false;
    }
    return true;
  });
  if (!valid.length) return null;

  valid.sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));

  let chosen = valid[0];
  let pairSwitched = false;
  if (preferredPair) {
    const match = valid.find((p) => p.pairAddress === preferredPair);
    if (match) {
      chosen = match;
    } else {
      pairSwitched = true;
    }
  }

  return {
    price: Number(chosen.priceUsd),
    liqUsd: Number(chosen.liquidity?.usd ?? 0),
    pair: chosen.pairAddress ?? null,
    pairSwitched,
  };
}

export async function getQuote(mint, opts = {}) {
  const preferredPair = typeof opts === "string" ? opts : (opts?.preferredPair ?? null);
  const fetchFn = opts?.fetch ?? fetch;
  try {
    const r = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return selectPair(j?.pairs, preferredPair, { mint });
  } catch {
    return null;
  }
}
