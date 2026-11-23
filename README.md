# token-radar-radar3

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anvxxr-arch/token-radar-radar3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anvxxr-arch/token-radar-radar3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have no token yet. The snapshot holds 758 DeFi protocols; 128 of them report both a TVL and a market cap, and those 128 are the training rows. `radar-3` fits one equation on them — log market cap against log TVL, log age and seven-day change — chooses it over three alternatives by walk-forward rank correlation, then prices the 293 pre-token protocols that survive screening. Every row carries an 80% band from the fit's residual spread and a fit-range label that says whether the row is an interpolation or an extrapolation. Screened off the board: 288 protocols that already list a ticker, 42 exchanges, 8 above the fitted TVL range. The dashboard is one dark console page: the model card with the fitted coefficients, the four-model comparison, a calibration scatter of the 128 training rows against the 1:1 line, a sortable 293-row board, a detail drawer with the six-step farm plan, and the 40-name watchlist.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=s5jfvfmx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
