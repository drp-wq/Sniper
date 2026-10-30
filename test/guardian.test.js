import test from "node:test";
import assert from "node:assert/strict";
import { unlinkSync, existsSync } from "node:fs";
import { RiskGuardian } from "../src/guardian.js";
import { resetPositions, openPaper, closePaperPosition, getDailyRealizedPnl, savePositions, loadPositions, isOpen } from "../src/paper.js";
import { computeDailyPnl } from "../src/stats.js";

test("RiskGuardian: allows valid signal when all checks pass", () => {
  const sig = { mint: "Token_Alpha_1", ts: Date.now() };
  const res = RiskGuardian.evaluate(sig, { halt: false, openCount: 0, isOpen: false, dailyLoss: 0 });
  assert.equal(res.allow, true);
  assert.equal(res.reason, "approved");
});

test("RiskGuardian: blocks entry when KillSwitch is engaged", () => {
  const sig = { mint: "Token_Alpha_2", ts: Date.now() };
  const res = RiskGuardian.evaluate(sig, { halt: true, openCount: 0 });
  assert.equal(res.allow, false);
  assert.equal(res.reason, "kill_switch_active");
});

test("RiskGuardian: blocks entry when signal is stale", () => {
  const sig = { mint: "Token_Alpha_3", ts: Date.now() - 90000 };
  const res = RiskGuardian.evaluate(sig, { halt: false, now: Date.now() });
  assert.equal(res.allow, false);
  assert.equal(res.reason, "stale_signal");
});

test("RiskGuardian: blocks entry when max open positions limit is reached", () => {
  const sig = { mint: "Token_Alpha_4", ts: Date.now() };
  const res = RiskGuardian.evaluate(sig, { halt: false, openCount: 5 });
  assert.equal(res.allow, false);
  assert.equal(res.reason, "max_open_reached");
});

test("RiskGuardian: blocks entry when daily paper loss limit is exceeded", () => {
  const sig = { mint: "Token_Alpha_5", ts: Date.now() };
  const res = RiskGuardian.evaluate(sig, { halt: false, dailyLoss: -55 });
  assert.equal(res.allow, false);
  assert.equal(res.reason, "daily_loss_limit_exceeded");
});

test("closePaperPosition: safely closes paper position and updates daily PnL", async () => {
  resetPositions();
  const mockQuote = async () => ({ price: 10, liqUsd: 50000 });
  await openPaper("Token_Close_Test", "sig123", { getQuote: mockQuote, retryDelayMs: 0 });
  
  const closed = closePaperPosition("Token_Close_Test", "manual_close");
  assert.equal(closed, true);
  
  const closedAgain = closePaperPosition("Token_Close_Test", "manual_close");
  assert.equal(closedAgain, false);
});

test("openPaper: sends alert with suitable entry price, stop-loss, and take-profit", async () => {
  resetPositions();
  const mockQuote = async () => ({ price: 0.05, liqUsd: 25000 });
  let alertText = "";
  const mockNotify = (msg) => { alertText = msg; };

  await openPaper("Token_Alert_Test", "sig999", {
    getQuote: mockQuote,
    retryDelayMs: 0,
    notify: mockNotify,
  });

  assert.ok(alertText.includes("PAPER BUY"));
  assert.ok(alertText.includes("Entry: $0.0525"));
  assert.ok(alertText.includes("Stop-Loss: $0.0394 (-25%)"));
  assert.ok(alertText.includes("Take-Profit: $0.1050 (+100% | Sell 50%)"));
  assert.ok(alertText.includes("Trailing Stop: Arms at $0.0788 (+50%)"));
  assert.ok(alertText.includes("GMGN: https://gmgn.ai/sol/token/Token_Alert_Test"));
  assert.ok(alertText.includes("DexScreener: https://dexscreener.com/solana/Token_Alert_Test"));
});

test("positions persist to disk via savePositions and recover safely on restart via loadPositions", async () => {
  const testFile = "logs/test_positions.json";
  if (existsSync(testFile)) unlinkSync(testFile);

  resetPositions(testFile);
  const mockQuote = async () => ({ price: 1.5, liqUsd: 80000, symbol: "TEST", name: "Test Coin" });
  await openPaper("Mint_Persist_1", "sigP1", { getQuote: mockQuote, retryDelayMs: 0 });
  savePositions(testFile);

  // Clear in-memory map without deleting disk file
  assert.equal(isOpen("Mint_Persist_1"), true);
  
  // Reload from disk
  const recovered = loadPositions(testFile);
  assert.equal(recovered, 1);
  assert.equal(isOpen("Mint_Persist_1"), true);

  // Clean up
  resetPositions(testFile);
  if (existsSync(testFile)) unlinkSync(testFile);
});

test("computeDailyPnl correctly isolates current day closed positions", () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const rows = [
    { ts: `${todayIso}T08:00:00Z`, ev: "paper_close", pnl: 25.5 },
    { ts: `${todayIso}T11:00:00Z`, ev: "paper_close", pnl: -10.2 },
    { ts: "2026-01-01T10:00:00Z", ev: "paper_close", pnl: 100.0 }, // Previous date, ignored
    { ts: `${todayIso}T12:00:00Z`, ev: "gate", pass: true },
  ];

  const pnlToday = computeDailyPnl(rows);
  assert.equal(pnlToday, 15.3);
});
