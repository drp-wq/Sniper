# Formal Pre-Registration of Hypotheses & Parameter Search Grid (research/prereg.md)

> **Integrity Mandate**: This document pre-registers all research hypotheses, statistical criteria, parameter grids, and multiple-testing correction protocols BEFORE backtesting against the out-of-sample partition. The out-of-sample Test partition ($N=300$) is locked and evaluated exactly once.

---

## 1. Pre-Registered Hypotheses

### Hypothesis 1 ($H_1$): Technical Gate Edge
- **Statement**: Filtering Solana meme coin launches through a fail-closed technical safety gate (verifying revoked mint/freeze authorities, absence of Token-2022 malicious extensions, top-10 concentration $<25\%$, and dev allocation $<5\%$) reduces the rug/honeypot hit rate from the baseline $>65\%$ down to $<5\%$.
- **Test Metric**: Out-of-sample rug hit rate ($\%$ of trades resulting in unexecutable sells or $<-50\%$ immediate loss).
- **Threshold for Acceptance**: Rug hit rate $\le 5.0\%$.

### Hypothesis 2 ($H_2$): Asymmetric Expectancy
- **Statement**: Combining the safety gate with an asymmetric exit ladder (hard $-20\%$ to $-25\%$ stop-loss, banking $50\%$ at $+100\%$ with auto-breakeven, and dynamic trailing stop) yields positive net expectancy after accounting for $5\%$ entry slippage, $8\%$ exit slippage, and realistic priority fee drag.
- **Test Metric**: Net expectancy $E = p \cdot \text{avgWin} - (1-p) \cdot \text{avgLoss} > 0$.
- **Threshold for Acceptance**: $E > 0$ with $p < 0.05$ after multiple-testing correction.

### Hypothesis 3 ($H_3$): Baseline Outperformance
- **Statement**: Strategy 3 significantly outperforms both Baseline A (Random Entry) and Baseline B (Naive Liquidity Filter without on-chain safety gates) on profit factor, maximum drawdown, and Sortino ratio.

---

## 2. Pre-Registered Parameter Grid ($K = 9$ Variants)

The search space is strictly bounded to $K = 9$ discrete combinations tested exclusively on the Validation set:

| Variant ID | Stop-Loss | Take-Profit Half (TP1) | Trailing Stop Arm | Dynamic Trail Pullback |
|:---:|:---:|:---:|:---:|:---:|
| `P1_SL20_TP80` | $-20\%$ | $+80\%$ | $+40\%$ | $15\%$ |
| `P2_SL25_TP100_Base` | $-25\%$ | $+100\%$ | $+50\%$ | $20\%$ |
| `P3_SL30_TP120` | $-30\%$ | $+120\%$ | $+60\%$ | $25\%$ |
| `P4_SL25_TP80` | $-25\%$ | $+80\%$ | $+50\%$ | $15\%$ |
| `P5_SL20_TP100` | $-20\%$ | $+100\%$ | $+40\%$ | $20\%$ |
| `P6_SL30_TP100` | $-30\%$ | $+100\%$ | $+60\%$ | $20\%$ |
| `P7_SL25_TP120` | $-25\%$ | $+120\%$ | $+50\%$ | $25\%$ |
| `P8_SL20_TP120` | $-20\%$ | $+120\%$ | $+40\%$ | $25\%$ |
| `P9_SL30_TP80` | $-30\%$ | $+80\%$ | $+60\%$ | $15\%$ |

---

## 3. Multiple Testing Correction Protocol

To control the Family-Wise Error Rate (FWER) across the $K = 9$ parameter evaluations:
- **Baseline Alpha**: $\alpha = 0.05$.
- **Bonferroni Adjusted Significance Threshold**:
  $$\alpha_{\text{adj}} = \frac{\alpha}{K} = \frac{0.05}{9} \approx 0.00555$$
- Any parameter variant claiming statistical significance on Validation data must achieve a two-tailed $p$-value $< 0.00555$.

---

## 4. Dataset Partition Protocol (Zero Lookahead Bias)
- **Dataset Size**: $1,000$ chronological launches.
- **Train Split (40%)**: Tokens $1$ to $400$.
- **Validation Split (30%)**: Tokens $401$ to $700$ (Parameter selection only).
- **Test / Out-of-Sample Split (30%)**: Tokens $701$ to $1000$ (Evaluated exactly once on the optimal variant selected from Validation).
