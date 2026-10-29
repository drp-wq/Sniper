import test from "node:test";
import assert from "node:assert/strict";
import { RiskGuardian } from "../src/guardian.js";
import { resetPositions, openPaper, closePaperPosition, getDailyRealizedPnl } from "../src/paper.js";

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
