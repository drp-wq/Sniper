/**
 * Test Tokens for Sniper Bot
 * Known Solana mints for manual signal injection and safety gate diagnostics.
 */

export const SAMPLE_TEST_MINTS = [
  {
    name: 'Wrapped SOL (Baseline Clean)',
    mint: 'So11111111111111111111111111111111111111112',
    expected: 'PASS',
  },
  {
    name: 'Jupiter (JUP)',
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    expected: 'PASS',
  },
  {
    name: 'Bonk (BONK)',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    expected: 'PASS',
  },
  {
    name: 'dogwifhat (WIF)',
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    expected: 'PASS',
  },
  {
    name: 'USDC (Active Freeze Authority)',
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    expected: 'REJECT (Freeze Authority Active)',
  },
];
