# token-radar-radar2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anvxxr-arch/token-radar-radar2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anvxxr-arch/token-radar-radar2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that have no token yet. It reads one sealed snapshot of the DeFi protocol index, ranks every pre-token protocol by an implied value built from its TVL, its seven-day growth measured against its own category, how long it has run with no token and a small liquidity size term, then gives each row a six-step farm plan with a dollar cost and a duration. The dashboard is a single dark console page: board, per-protocol detail with the model's four multipliers, a live model sandbox and a live-token comparison. Model `radar-2`, no protocol name special-cased anywhere.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=s5jfvfmx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
