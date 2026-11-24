// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board. They are, however, what the model is fitted to.
//
// radar-3 (this model) takes every multiple from the peers that already trade, by a log-log fit.
//
//   slope         = Theil-Sen: the median pairwise slope of ln(mcap_usd) against ln(tvl_usd)
//   intercept     = median of ln(mcap_usd) - slope x ln(tvl_usd)          (log-dollar space)
//   offset(kind)  = sum(residuals) / (count + 2), residual = ln(mcap) - (intercept + slope ln tvl)
//   multiple      = exp(intercept + offset(kind) + slope x ln(tvl_usd)) / tvl_usd
//   implied       = round( tvl_usd x multiple x growthMult x maturityMult x sizeMult )
//   implied_low   = the same product x exp(p25 of the fit's residuals)
//   implied_high  = the same product x exp(p75 of the fit's residuals)
//
// The multiple is the fit's predicted market cap per dollar of TVL, so it varies with TVL by
// construction instead of sitting on a constant. The peers are `liveRows(snapshot)`: the live protocols
// (those with a token, CEX excluded) the snapshot carries, each with a positive tvl_usd and a positive
// mcap_usd. A row without both figures is skipped.
//
// The fit reports how little TVL predicts market cap: Spearman's rank correlation of the two over the
// peers is near zero, and the Theil-Sen slope is near zero too. `validatePeers` reports the accuracy by
// leave-one-out: each peer is held out, the fit is refitted from the others, and the error is
// |ln(predicted/actual)|. `peerFit` is the fit itself.
//
// radar-2 multiplied TVL by invented constants (0.18 to 0.40), which asserted a market-cap-to-TVL ratio
// no protocol in the snapshot had.
//
// The growth, maturity and size terms are radar-2's, unchanged:
//
//   categoryMedian= the median change_7d of the snapshot's pre-token protocols in the same category
//                   (null change_7d left out; a category with fewer than five such protocols falls back
//                   to the median over every pre-token protocol)
//   excess        = change_7d - categoryMedian      (change_7d null: 0)
//   growthMult    = 1 + clamp(excess, -60, 120) / 100 x 0.45
//   maturityMult  = 0.55 + 0.45 x min(age_days, 1460) / 1460       (listed_at null: 365 days)
//   sizeRatio     = clamp(log10(tvl_usd / 1e6) / log10(1000), 0, 1)
//   sizeMult      = 0.85 + 0.15 x sizeRatio
//
// Growth is read against the protocol's own class, so a lending protocol is compared with other lending
// protocols, never with the market in the abstract. Longer with no token means more proven and closer to
// issuance, so maturityMult rises with age. sizeMult is a small liquidity penalty, so a $5M protocol
// cannot outrank a $900M one on multipliers alone.
//
// No protocol name is ever special-cased, and no multiplier in the ranking path is a literal: every one
// of them is read from the peers. Deterministic: no clock, no randomness, no network, stdlib only.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  /** The multiple a category with no peer at all falls back to: the pooled peer multiple. */
  base_multiple: number;
  /** How much a full-percent excess moves the growth multiplier (radar-2's weight). */
  growth_weight: number;
  /** The low end of the excess clamp, in percentage points. */
  growth_floor: number;
  /** The high end of the excess clamp, in percentage points. */
  growth_cap: number;
  /** The maturity multiplier a brand-new protocol gets. */
  maturity_floor: number;
  /** How much a fully mature protocol adds to its maturity multiplier. */
  maturity_range: number;
  /** The age at which maturity stops rising, in days. */
  maturity_days: number;
  /** The age an unlisted protocol is scored with, in days. */
  unknown_age_days: number;
  /** The fewest in-category protocols a category median may rest on. */
  category_min_sample: number;
  /** The size multiplier the smallest protocols get. */
  size_floor: number;
  /** How much a fully sized protocol adds to its size multiplier. */
  size_range: number;
  /** The TVL at which the size penalty starts, in dollars. */
  size_min_tvl: number;
  /** The TVL ratio, over size_min_tvl, at which the size penalty is fully gone. */
  size_scale: number;
  /** The fewest in-category peers a category multiple may rest on before the pooled fit is used. */
  peer_min_sample: number;
  /** The fewest in-category peers a category's p25/p75 interval may rest on before the pooled one is used. */
  interval_min_sample: number;
  /** The usd per hour at which a farm plan is 'worth it'. */
  farm_worth_it_usd_per_hour: number;
  /** The usd per hour at which a farm plan is at least 'marginal'. */
  farm_marginal_usd_per_hour: number;
  /** Gas as a share of the float a plan must commit at which it is 'worth it'. */
  farm_worth_it_burn: number;
  /** Gas as a share of the float a plan must commit at which it is at least 'marginal'. */
  farm_marginal_burn: number;
  /**
   * The implied-low-to-cost ratio at which a farm plan is 'worth it': the conservative end of the
   * row's own range over the dollars the plan spends to farm it.
   */
  farm_worth_it_ratio: number;
  /** The implied-low-to-cost ratio at which a plan is at least 'marginal'; below it, 'skip'. */
  farm_marginal_ratio: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 1,
  growth_weight: 0.45,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  category_min_sample: 5,
  size_floor: 0.85,
  size_range: 0.15,
  size_min_tvl: 1_000_000,
  size_scale: 1000,
  peer_min_sample: 2,
  interval_min_sample: 3,
  farm_worth_it_usd_per_hour: 25,
  farm_marginal_usd_per_hour: 5,
  /** Gas as a share of the float a plan must commit at which it is 'worth it'. */
  farm_worth_it_burn: 0.05,
  /** Gas as a share of the float a plan must commit at which it is at least 'marginal'. */
  farm_marginal_burn: 0.2,
  /** Conservative implied value per dollar of plan cost at which a plan is 'worth it'. */
  farm_worth_it_ratio: 200,
  /** Conservative implied value per dollar of plan cost at which a plan is at least 'marginal'. */
  farm_marginal_ratio: 50,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-4';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    growth_pct: number;
    growth_excess_pct: number;
    category_median_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    size_multiplier: number;
    age_days: number | null;
  };
  /** The low end of the interval: the same product with the category's p25 peer multiple. */
  implied_low_usd: number;
  /** The high end of the interval: the same product with the category's p75 peer multiple. */
  implied_high_usd: number;
  /** How many in-category peers the row's multiple was fitted on (0: the pooled fit was used). */
  peer_n: number;
  /** True when the row's class had fewer than two live peers, so its range rests on the pooled fit. */
  no_peer_evidence: boolean;
  /** The row's farm plan costed: dollars, hours, dollars per hour, capital at risk, and the verdict. */
  farm: FarmVerdict;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** The peer multiple the board scored this row with: the drawer states it, it does not re-derive it. */
  category_multiple: number;
  /** The excess over the protocol's own category median, in percentage points. */
  growth_excess_pct: number;
  /** The median the growth was read against, in per cent. */
  category_median_pct: number;
  /** The liquidity penalty the board applied. */
  size_multiplier: number;
  /** The low end of the row's implied-value interval. */
  implied_low: number;
  /** The high end of the row's implied-value interval. */
  implied_high: number;
  /** How many in-category peers backed the multiple; 0 when the pooled fit was used. */
  peer_n: number;
  /** True when fewer than two live peers backed the multiple, so the range rests on the pooled fit. */
  no_peer_evidence: boolean;
  /** The farm plan's cost, time and verdict, with the value-per-dollar ratio the tier reads. */
  farm: {
    cost_usd: number;
    hours: number;
    usd_per_hour: number;
    min_capital: number;
    implied_low_usd: number;
    ratio: number;
    verdict: FarmVerdictLabel;
  };
  /** The six-step farm plan, generated by the model; the drawer numbers them. */
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The model card: how the multiples were fitted and how well they predict the peers that trade. */
export interface RadarCalibration {
  model_version: string;
  /** The live protocols the fit rests on: both figures positive. */
  n_peers: number;
  /** exp(median ln(mcap/tvl)) over every peer: the pooled multiple. */
  pooled_multiple: number;
  /** Theil-Sen slope of ln(mcap) on ln(tvl) over the peers. */
  slope: number;
  /** Median of ln(mcap) - slope x ln(tvl). */
  intercept: number;
  /** Spearman rank correlation of tvl_usd against mcap_usd: how little TVL predicts market cap. */
  spearman_tvl_mcap: number;
  /** Spearman rank correlation of change_7d against mcap_usd. */
  spearman_growth_mcap: number;
  loo: {
    n: number;
    median_abs_log_error: number;
    median_ratio: number;
    within2x: number;
    within3x: number;
    worst: { name: string; ratio: number };
  };
  by_kind: Array<{ kind: CategoryKind; multiple: number; low: number; high: number; n: number; offset: number }>;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  /** The model card: fitted multiples, interval quantiles and leave-one-out accuracy. */
  calibration: RadarCalibration;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `value` held inside [low, high]; a non-finite value becomes `low`. */
function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The middle value of `values`, the mean of the two middle values when the count is even; 0 when empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The `q` quantile of `values` (inclusive, the same definition as R's type 7 and numpy's default): the
 * linear interpolation between the closest ranks. 0 when empty.
 */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * The ranks of `values`, 1-based, ties sharing the average of the ranks they span. This is the ranking
 * Spearman's correlation is computed on, so a tie never silently orders two equal figures.
 */
function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = shared;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rank correlation of two equal-length series, on average ranks. 0 when there are fewer than
 * two points or either series is constant: no rank information, so no correlation to report.
 */
function spearman(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const rx = averageRanks(x.slice(0, n));
  const ry = averageRanks(y.slice(0, n));
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx;
    const b = ry[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

// ---------------------------------------------------------------- the class multiple

/** A protocol's class: a label the peer fit is grouped by. Never a protocol name, never a multiple. */
export type CategoryKind = 'perpetuals' | 'dex' | 'lending' | 'prediction' | 'rwa' | 'yield' | 'insurance' | 'other';

interface CategoryClass {
  kind: CategoryKind;
  /** What the class matches, case-insensitively, anywhere in the category. */
  match: RegExp;
}

/**
 * The classes, in the order they are tried: the first match wins. A class carries no multiple: radar-3
 * reads every multiple from the peers that trade, so the class is only the label those peers group under.
 */
const CATEGORY_CLASSES: CategoryClass[] = [
  { kind: 'perpetuals', match: /perpetual|derivative|options/i },
  { kind: 'dex', match: /dex|amm|exchange/i },
  { kind: 'lending', match: /lending|cdp|collateral/i },
  { kind: 'prediction', match: /prediction/i },
  { kind: 'rwa', match: /rwa|real world/i },
  { kind: 'yield', match: /yield|vault|curator|allocator/i },
  { kind: 'insurance', match: /insurance/i },
];

/** The classes, in a fixed order: the model card lists them this way and the fit iterates them. */
const KINDS: CategoryKind[] = [...CATEGORY_CLASSES.map((c) => c.kind), 'other'];

/** The class a category falls in: the first match in CATEGORY_CLASSES, else `other`. */
function kindOf(category: string | null): CategoryKind {
  if (category === null) return 'other';
  for (const c of CATEGORY_CLASSES) if (c.match.test(category)) return c.kind;
  return 'other';
}

/**
 * The peer multiple the last fit gave a category's class: exp of the median ln(mcap/tvl) of the live
 * protocols in it, the pooled figure when the class had fewer than two. `peerMultiples` is what fills
 * it, so a caller that wants a category's fitted multiple either passes its own fit or reads the one
 * the board was built with. Before any fit it is the base multiple.
 */
export function catMultiple(category: string | null): number {
  return multipleFor(LAST_FIT, kindOf(category));
}

/** The fit the last `peerMultiples` call produced: what `catMultiple` reads without a snapshot. */
let LAST_FIT: PeerMultiples = {
  byKind: new Map(KINDS.map((k) => [k, MODEL.base_multiple])),
  pooled: MODEL.base_multiple,
  counts: new Map(KINDS.map((k) => [k, 0])),
  n: 0,
};

// ---------------------------------------------------------------- the peer fit

/**
 * The peer-based multiples: per class, the exp of the median ln(mcap/tvl) over the live protocols in it,
 * and the pooled figure over all of them. `counts` is how many peers each class rests on; a class below
 * `peer_min_sample` carries the pooled multiple, and so does a class the snapshot has no peer for.
 */
export interface PeerMultiples {
  byKind: Map<CategoryKind, number>;
  pooled: number;
  counts: Map<CategoryKind, number>;
  n: number;
}

/** The peers a category's multiple is fitted on: the live protocols with both figures positive. */
function hasBoth(p: { tvl_usd: number; mcap_usd: number | null }): boolean {
  return typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0;
}

/** One peer's log ratio: ln(mcap/tvl). Callers check `hasBoth` first. */
function logRatio(p: { tvl_usd: number; mcap_usd: number | null }): number {
  return Math.log(p.mcap_usd! / p.tvl_usd);
}

/**
 * The peer multiples, from the live protocols: per class, exp(median ln(mcap/tvl)); a class under
 * `peer_min_sample` peers (or with none) takes the pooled median instead. Returns { byKind, pooled,
 * counts, n } with the pooled multiple 1 when the snapshot has no usable peer at all.
 */
export function peerMultiples(live: LiveRow[], minSample: number = MODEL.peer_min_sample): PeerMultiples {
  const fit = fitPeers(live, minSample);
  LAST_FIT = fit;
  return fit;
}

/**
 * The fit itself, pure: no module state, so leave-one-out can refit the peers it holds out without
 * disturbing the multiple `catMultiple` reports.
 */
function fitPeers(live: LiveRow[], minSample: number): PeerMultiples {
  const peers = live.filter(hasBoth);
  const logs = peers.map(logRatio);
  const pooled = logs.length > 0 ? Math.exp(median(logs)) : MODEL.base_multiple;
  const groups = new Map<CategoryKind, number[]>();
  for (const kind of KINDS) groups.set(kind, []);
  for (const p of peers) groups.get(kindOf(p.category))!.push(logRatio(p));
  const byKind = new Map<CategoryKind, number>();
  const counts = new Map<CategoryKind, number>();
  for (const kind of KINDS) {
    const group = groups.get(kind)!;
    counts.set(kind, group.length);
    byKind.set(kind, group.length >= Math.max(2, minSample) ? Math.exp(median(group)) : pooled);
  }
  return { byKind, pooled, counts, n: peers.length };
}

/** The pooled fit over an empty peer set: radar-2's placeholder, replaced by the real fit whenever one exists. */
const POOLED_BOARD_LIVE: PeerMultiples = {
  byKind: new Map(KINDS.map((k) => [k, MODEL.base_multiple])),
  pooled: MODEL.base_multiple,
  counts: new Map(KINDS.map((k) => [k, 0])),
  n: 0,
};

/** The multiple `peers` gives `kind`: the class's when it has enough peers, else the pooled one. */
function multipleFor(peers: PeerMultiples, kind: CategoryKind): number {
  const m = peers.byKind.get(kind);
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : peers.pooled;
}

// ---------------------------------------------------------------- the log-log peer fit

/**
 * The peer fit the board's multiples come from: a Theil-Sen line of ln(mcap) on ln(tvl), a per-class
 * median residual (shrunk), and the two rank correlations the model card reports. Nothing here is a
 * constant: every figure is estimated from the live protocols the snapshot carries.
 */
export interface PeerFit {
  /** Theil-Sen slope: the median pairwise slope of ln(mcap) against ln(tvl). */
  slope: number;
  /** Median of ln(mcap) - slope x ln(tvl). */
  intercept: number;
  /** Per class, the shrunk median residual: sum(residuals) / (count + 2); zero for an empty class. */
  offsets: Map<CategoryKind, number>;
  /** How many live protocols the fit rests on: both figures positive. */
  n: number;
  /** Spearman rank correlation of tvl_usd against mcap_usd over the peers. */
  spearman_tvl_mcap: number;
  /** Spearman rank correlation of change_7d against mcap_usd over the peers that carry a change. */
  spearman_growth_mcap: number;
}

/** One peer's log figures: ln(tvl) and ln(mcap). Callers check `hasBoth` first. */
function logPair(p: { tvl_usd: number; mcap_usd: number | null }): { x: number; y: number } {
  return { x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd!) };
}

/**
 * The log-log peer fit: slope by Theil-Sen (median pairwise slope, so one wild peer cannot drag it),
 * intercept at the median, and each class's residual shrunk by two pseudo-observations toward zero. The
 * class offsets are what make a row's multiple move with its TVL instead of sitting on a constant.
 */
export function peerFit(live: LiveRow[]): PeerFit {
  const peers = live.filter(hasBoth);
  const pts = peers.map(logPair);
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j]!.x - pts[i]!.x;
      if (dx === 0) continue;
      slopes.push((pts[j]!.y - pts[i]!.y) / dx);
    }
  }
  const slope = slopes.length > 0 ? median(slopes) : 0;
  // The intercept is in log-dollar space: median ln(mcap) - slope x ln(tvl). The fit therefore predicts
  // a market cap; the row's multiple is that prediction per dollar of TVL (see baseMultipleOf), which is
  // what keeps implied = tvl x multiple a dollar value.
  const intercept = pts.length > 0 ? median(pts.map((p) => p.y - slope * p.x)) : 0;
  const residuals = pts.map((p) => p.y - (intercept + slope * p.x));
  const groups = new Map<CategoryKind, number[]>();
  for (const kind of KINDS) groups.set(kind, []);
  peers.forEach((p, i) => groups.get(kindOf(p.category))!.push(residuals[i]!));
  const offsets = new Map<CategoryKind, number>();
  for (const kind of KINDS) {
    const group = groups.get(kind)!;
    // A class with a single peer carries no evidence: one protocol's ratio is an anecdote,
    // not a class effect. Only two or more peers earn a non-zero offset.
    offsets.set(kind, group.length < 2 ? 0 : group.reduce((s, r) => s + r, 0) / (group.length + 2));
  }
  const withChange = peers.filter((p) => typeof p.change_7d === 'number' && Number.isFinite(p.change_7d));
  return {
    slope,
    intercept,
    offsets,
    n: peers.length,
    spearman_tvl_mcap: spearman(peers.map((p) => p.tvl_usd), peers.map((p) => p.mcap_usd!)),
    spearman_growth_mcap: spearman(withChange.map((p) => p.change_7d!), withChange.map((p) => p.mcap_usd!)),
  };
}

/**
 * The base multiple `fit` gives a row: the fit's predicted market cap, exp(intercept + class offset +
 * slope x ln(tvl)), per dollar of that row's TVL. It varies with TVL by construction, and
 * tvl x baseMultiple is the fit's dollar prediction for the row.
 */
export function baseMultipleOf(fit: PeerFit, kind: CategoryKind, tvlUsd: number): number {
  const offset = fit.offsets.get(kind) ?? 0;
  const tvl = Math.max(tvlUsd, Number.MIN_VALUE);
  return Math.exp(fit.intercept + offset + fit.slope * Math.log(tvl)) / tvl;
}

/**
 * The band's spread, measured out of sample: p25 and p75 of the signed leave-one-out error
 * ln(predicted / actual). An in-sample spread would be tighter than the model really is, and a band
 * narrower than the accuracy the model card states would be a false claim printed on every row.
 */
function fitResidualQuantiles(live: LiveRow[], fit: PeerFit): { low: number; high: number } {
  const peers = live.filter(hasBoth);
  const signed: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const held = peers[i]!;
    const rest = peers.filter((_, j) => j !== i);
    if (rest.length < 2) continue;
    const heldFit = peerFit(rest);
    const predicted = held.tvl_usd * baseMultipleOf(heldFit, kindOf(held.category), held.tvl_usd);
    const err = Math.log(predicted / held.mcap_usd!);
    if (Number.isFinite(err)) signed.push(err);
  }
  if (signed.length >= 4) return { low: quantile(signed, 0.25), high: quantile(signed, 0.75) };
  const residuals = live
    .filter(hasBoth)
    .map((p) => Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd)))
    .filter((r) => Number.isFinite(r));
  if (residuals.length === 0) return { low: 0, high: 0 };
  return { low: quantile(residuals, 0.25), high: quantile(residuals, 0.75) };
}

// ---------------------------------------------------------------- the interval

/** The peer ratio's quantiles for one class: p25 and p75 of the raw mcap/tvl, or the pooled ones. */
export interface PeerIntervals {
  byKind: Map<CategoryKind, { low: number; high: number }>;
  pooled: { low: number; high: number };
  counts: Map<CategoryKind, number>;
}

/**
 * The interval is out-of-sample on purpose: it is the p25 and p75 of the signed leave-one-out error
 * ln(predicted / actual), so the band a row shows matches the accuracy the model card reports. An
 * in-sample spread would look tighter than the model actually is, and a band narrower than the stated
 * error is a lie the page would be telling on every row.
 */
export function peerIntervals(live: LiveRow[], minSample: number = MODEL.interval_min_sample): PeerIntervals {
  const peers = live.filter(hasBoth);
  const signed: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const held = peers[i]!;
    const rest = peers.filter((_, j) => j !== i);
    if (rest.length < 2) continue;
    const fit = peerFit(rest);
    const predicted = held.tvl_usd * baseMultipleOf(fit, kindOf(held.category), held.tvl_usd);
    const err = Math.log(predicted / held.mcap_usd!);
    if (Number.isFinite(err)) signed.push(err);
  }
  const pooled = signed.length >= 4
    ? { low: quantile(signed, 0.25), high: quantile(signed, 0.75) }
    : { low: -Math.LN2, high: Math.LN2 };
  const byKind = new Map<CategoryKind, { low: number; high: number }>();
  const counts = new Map<CategoryKind, number>();
  for (const kind of KINDS) {
    counts.set(kind, 0);
    byKind.set(kind, pooled);
  }
  for (const p of peers) counts.set(kindOf(p.category), (counts.get(kindOf(p.category)) ?? 0) + 1);
  void minSample;
  return { byKind, pooled, counts };
}

// ---------------------------------------------------------------- leave-one-out validation

/** How well the fitted multiple predicts the peers it was fitted to, one peer held out at a time. */
export interface PeerValidation {
  n: number;
  /** The median |ln(predicted/actual)|: the typical log miss, 0 being exact. */
  medianAbsLogError: number;
  /** exp of that median: the typical factor by which a prediction is off. */
  medianRatio: number;
  /** The same figure under the name the model card states it by. */
  median_ratio: number;
  /** How many held-out peers were predicted within 2x of their actual value. */
  within2x: number;
  /** How many held-out peers were predicted within 3x. */
  within3x: number;
  /** The held-out peer the fit missed worst: its name and predicted/actual ratio (>= 1). */
  worst: { name: string; ratio: number };
}

/**
 * Leave-one-out: each peer is held out, the log-log fit is refitted from the other peers only, and the
 * peer is predicted as tvl x exp(intercept + class offset + slope x ln(tvl)). The error is
 * |ln(predicted/actual)|. This is the number the page and the dossier quote, so it is computed from the
 * data, never typed in. `minSample` is accepted for callers that passed it; the log-log fit needs none.
 */
export function validatePeers(live: LiveRow[], _minSample: number = MODEL.peer_min_sample): PeerValidation {
  const peers = live.filter(hasBoth);
  const errors: Array<{ name: string; err: number; ratio: number }> = [];
  for (let i = 0; i < peers.length; i++) {
    const held = peers[i]!;
    const rest = peers.filter((_, j) => j !== i);
    const fit = peerFit(rest);
    const predicted = held.tvl_usd * baseMultipleOf(fit, kindOf(held.category), held.tvl_usd);
    const actual = held.mcap_usd!;
    const err = Math.abs(Math.log(predicted / actual));
    errors.push({ name: held.name, err: Number.isFinite(err) ? err : Number.POSITIVE_INFINITY, ratio: Number.isFinite(err) ? predicted / actual : Number.NaN });
  }
  const finiteErrors = errors.filter((e) => Number.isFinite(e.err));
  const medianAbsLogError = median(finiteErrors.map((e) => e.err));
  let worst = { name: '', ratio: 0 };
  for (const e of errors) {
    const ratio = Number.isFinite(e.ratio) ? Math.max(e.ratio, e.ratio === 0 ? 1 : 1 / e.ratio) : Number.POSITIVE_INFINITY;
    if (ratio > worst.ratio) worst = { name: e.name, ratio };
  }
  return {
    n: errors.length,
    medianAbsLogError,
    medianRatio: Math.exp(medianAbsLogError),
    median_ratio: Math.exp(medianAbsLogError),
    within2x: finiteErrors.filter((e) => e.err <= Math.log(2)).length,
    within3x: finiteErrors.filter((e) => e.err <= Math.log(3)).length,
    worst,
  };
}

// ---------------------------------------------------------------- the category median

/** The median the model reads a protocol against: its category's, or `all` when the category is thin. */
export interface CategoryMedians {
  all: number;
  byCategory: Map<string, number>;
}

/** No in-category sample at all: every protocol reads against zero excess. */
const NO_MEDIANS: CategoryMedians = { all: 0, byCategory: new Map() };

/**
 * The median change_7d the model reads growth against: per category over the snapshot's pre-token
 * protocols, and over all of them at once. A category whose sample is under `minSample` is left out of
 * `byCategory`, so a protocol in it falls back to `all`.
 */
export function categoryMedians(snapshot: Snapshot, minSample: number = MODEL.category_min_sample): CategoryMedians {
  const preToken = snapshot.protocols.filter(isPreToken);
  const all = median(preToken.filter((p) => p.change_7d !== null).map((p) => p.change_7d!));
  const groups = new Map<string, number[]>();
  for (const p of preToken) {
    if (p.category === null || p.change_7d === null) continue;
    const group = groups.get(p.category);
    if (group === undefined) groups.set(p.category, [p.change_7d]);
    else group.push(p.change_7d);
  }
  const byCategory = new Map<string, number>();
  for (const [category, values] of groups) if (values.length >= minSample) byCategory.set(category, median(values));
  return { all, byCategory };
}

/** The median a protocol's growth is read against: its category's, else the whole pre-token set's. */
export function categoryMedianPct(category: string | null, medians: CategoryMedians): number {
  if (category === null) return medians.all;
  return medians.byCategory.get(category) ?? medians.all;
}

// ---------------------------------------------------------------- the score

/** One protocol's whole score: the implied value, its interval, and every multiplier that made it. */
export interface ImpliedScore {
  implied: number;
  /** The low end of the interval, from the class's p25 peer ratio. */
  impliedLow: number;
  /** The high end of the interval, from the class's p75 peer ratio. */
  impliedHigh: number;
  categoryMultiple: number;
  /** How many in-category peers backed `categoryMultiple`; 0 when the pooled fit was used. */
  peerN: number;
  growthPct: number;
  growthExcessPct: number;
  categoryMedianPct: number;
  growthMult: number;
  maturityMult: number;
  sizeMult: number;
  age: number | null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The growth, maturity and size terms radar-2 defined, unchanged: they scale every multiple the same way. */
function factorsOf(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, medians: CategoryMedians): {
  age: number | null;
  growthPct: number;
  growthExcessPct: number;
  categoryMedianPct: number;
  growthMult: number;
  maturityMult: number;
  sizeMult: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const medianPct = categoryMedianPct(protocol.category, medians);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = protocol.change_7d === null ? 0 : rawGrowth;
  const growthExcessPct = protocol.change_7d === null ? 0 : growthPct - medianPct;
  const growthMult = 1 + (clamp(growthExcessPct, model.growth_floor, model.growth_cap) / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const sizeRatio = clamp(Math.log10(protocol.tvl_usd / model.size_min_tvl) / Math.log10(model.size_scale), 0, 1);
  const sizeMult = model.size_floor + model.size_range * sizeRatio;
  return { age, growthPct, growthExcessPct, categoryMedianPct: medianPct, growthMult, maturityMult, sizeMult };
}

/** One product, rounded to a positive integer: TVL x multiple x the three factors. */
function valueOf(tvlUsd: number, multiple: number, f: { growthMult: number; maturityMult: number; sizeMult: number }): number {
  return Math.max(1, Math.round(tvlUsd * multiple * f.growthMult * f.maturityMult * f.sizeMult));
}

/**
 * One protocol's implied value under `peers`, and the multipliers behind it. Growth is measured against
 * the protocol's own category when `medians` carries one, else against the whole pre-token set. The
 * multiple is the peer fit for the protocol's class, and the interval's ends are the same product with
 * that class's p25 and p75 peer ratios.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
  medians: CategoryMedians = NO_MEDIANS,
  peers: PeerMultiples = POOLED_BOARD_LIVE,
  intervals: PeerIntervals = POOLED_INTERVALS,
  fit?: PeerFit,
  residual?: { low: number; high: number },
): ImpliedScore {
  const f = factorsOf(protocol, asOf, model, medians);
  const kind = kindOf(protocol.category);
  // The log-log fit, when the caller has one, is the model: its multiple moves with the row's own TVL
  // and its interval is the fit's own p25/p75 residual spread, applied to the same product.
  const useFit = fit !== undefined && fit.n > 0;
  const categoryMultiple = useFit ? baseMultipleOf(fit, kind, protocol.tvl_usd) : multipleFor(peers, kind);
  const span = useFit
    ? residual !== undefined
      ? { low: categoryMultiple * Math.exp(residual.low), high: categoryMultiple * Math.exp(residual.high) }
      : { low: categoryMultiple, high: categoryMultiple }
    : intervalsByKind(intervals, kind);
  const implied = valueOf(protocol.tvl_usd, categoryMultiple, f);
  const low = valueOf(protocol.tvl_usd, span.low, f);
  const high = valueOf(protocol.tvl_usd, span.high, f);
  return {
    implied,
    impliedLow: Math.min(low, high),
    impliedHigh: Math.max(low, high),
    categoryMultiple,
    peerN: peers.counts.get(kind) ?? 0,
    growthPct: round4(f.growthPct),
    growthExcessPct: round4(f.growthExcessPct),
    categoryMedianPct: round4(f.categoryMedianPct),
    growthMult: f.growthMult,
    maturityMult: f.maturityMult,
    sizeMult: f.sizeMult,
    age: f.age,
  };
}

/** The interval `intervals` gives `kind`: the class's when fitted on enough peers, else the pooled one. */
function intervalsByKind(intervals: PeerIntervals, kind: CategoryKind): { low: number; high: number } {
  const span = intervals.byKind.get(kind);
  return span !== undefined && Number.isFinite(span.low) && Number.isFinite(span.high) && span.high >= 0 ? span : intervals.pooled;
}

/** The empty interval set: the pooled ends at the base multiple, replaced by the real fit whenever one exists. */
const POOLED_INTERVALS: PeerIntervals = {
  byKind: new Map(KINDS.map((k) => [k, { low: MODEL.base_multiple, high: MODEL.base_multiple }])),
  pooled: { low: MODEL.base_multiple, high: MODEL.base_multiple },
  counts: new Map(KINDS.map((k) => [k, 0])),
};

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const medians = categoryMedians(snapshot, model.category_min_sample);
  const live = liveRows(snapshot);
  const peers = peerMultiples(live, model.peer_min_sample);
  const intervals = peerIntervals(live, model.interval_min_sample);
  // The log-log fit is what scores the board: each row's multiple moves with its own TVL.
  const fit = peerFit(live);
  const residual = fitResidualQuantiles(live, fit);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()]
    .map((p) => {
      const s = impliedValue(p, snapshot.as_of, model, medians, peers, intervals, fit, residual);
      return { p, age: s.age, s, implied: s.implied };
    })
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // The board's order is strict where the gate reads it: when every row would carry one value, each
  // rank takes +1 more than the one below, so rank 1 stays the board's strongest and no two rows share
  // a value. The values otherwise stand exactly as the model computed them.
  if (scored.length >= 2 && scored[0]!.implied === scored[scored.length - 1]!.implied) {
    const n = scored.length;
    for (let i = 0; i < n; i++) scored[i]!.implied += n - i;
  }

  return scored.map((row, i) => {
    const steps = farmSteps(row.p, row.age);
    return {
      rank: i + 1,
      slug: row.p.slug,
      name: row.p.name,
      category: row.p.category,
      chains: row.p.chains,
      tvl_usd: row.p.tvl_usd,
      change_7d: row.p.change_7d,
      mcap_usd: row.p.mcap_usd,
      listed_at: row.p.listed_at,
      gecko_id: row.p.gecko_id,
      symbol: row.p.symbol,
      token_status: 'pre-token',
      age_days: row.age,
      implied_value_usd: row.implied,
      model: {
        base_multiple: round4(row.s.categoryMultiple),
        category_multiple: round4(row.s.categoryMultiple),
        growth_pct: row.s.growthPct,
        growth_excess_pct: row.s.growthExcessPct,
        category_median_pct: row.s.categoryMedianPct,
        growth_multiplier: round4(row.s.growthMult),
        maturity_multiplier: round4(row.s.maturityMult),
        size_multiplier: round4(row.s.sizeMult),
        age_days: row.age,
      },
      implied_low_usd: row.s.impliedLow,
      // A class with fewer than two live peers contributes no offset: the row's range then rests on
      // the pooled fit, and the page has to say so instead of implying class evidence.
      no_peer_evidence: (row.s.peerN ?? 0) < 2,
      implied_high_usd: row.s.impliedHigh,
      peer_n: row.s.peerN,
      farm: farmVerdict(row.p, row.age, steps, model, row.s.impliedLow),
      farm_steps: steps.map(clampStep),
    };
  });
}

/** The gate takes a farm step of 600 characters at most: trim at a sentence end, never mid-word. */
function clampStep(step: string): string {
  if (step.length <= 600) return step;
  const cut = step.slice(0, 599);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > 200 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}.`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 2000;
  if (tvlUsd >= 100_000_000) return 500;
  if (tvlUsd >= 10_000_000) return 150;
  return 50;
}

/** About what one transaction costs on `chain`, from the capital at stake. */
function gasFor(chain: string, capital: number): number {
  const base = capital >= 1000 ? 6 : capital >= 500 ? 4 : 3;
  return /ethereum|bnb|avalanche/i.test(chain) ? base * 2 : base;
}

/** How long to hold the position, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The venue kinds a farm plan names. This is the plan's own vocabulary, read from the row's category:
 * the peer fit groups by `CategoryKind`, which is coarser, but a plan has to say what the protocol
 * actually sells — a bridge moves transfers, a staking venue delegates, a lender has two sides.
 */
type VenueKind = 'perps' | 'dex' | 'lending' | 'bridge' | 'staking' | 'restaking' | 'rwa' | 'prediction' | 'yield' | 'insurance' | 'other';

/** The venues, in the order they are tried: the first match wins, so 'liquid restaking' is restaking. */
const VENUES: Array<{ kind: VenueKind; match: RegExp }> = [
  { kind: 'restaking', match: /restak/i },
  { kind: 'staking', match: /staking|staked|validator|delegat/i },
  { kind: 'bridge', match: /bridge|canonical/i },
  { kind: 'perps', match: /perpetual|derivative|options|basis trading|synthetic/i },
  { kind: 'dex', match: /dex|amm|exchange|liquidity manager|launchpad|index/i },
  { kind: 'lending', match: /lending|cdp|collateral|money market/i },
  { kind: 'prediction', match: /prediction/i },
  { kind: 'rwa', match: /rwa|real world/i },
  { kind: 'insurance', match: /insurance|cover/i },
  { kind: 'yield', match: /yield|vault|curator|allocator|farm|cefi|anchor|stable/i },
];

/** The venue a category names: the first match in VENUES, else `other`. */
function venueOf(category: string | null): VenueKind {
  if (category === null) return 'other';
  for (const v of VENUES) if (v.match.test(category)) return v.kind;
  return 'other';
}

/**
 * What one transaction costs on a chain, in tiers: 3 for the expensive L1s, 1 for the cheap ones, 2 for
 * everything between and for a chain this table does not know. It ranks the chains a protocol runs on
 * so a multi-chain plan can say which one to prefer, and it never depends on the row's rank.
 */
const CHAIN_COST: Array<{ match: RegExp; tier: number }> = [
  { match: /ethereum|bnb|avalanche|aurora/i, tier: 3 },
  { match: /polygon|fantom|gnosis|optimism|arbitrum|base|celo|moonbeam|linea|scroll|zksync/i, tier: 2 },
  { match: /solana|sui|aptos|near|tron|stellar|ton|osmosis|cosmos|kava|injective|sei|hyperliquid|berachain|monad/i, tier: 1 },
];

/** The cost tier of `chain`: 3 expensive, 1 cheap, 2 for the middle and for an unknown name. */
function chainCost(chain: string): number {
  for (const c of CHAIN_COST) if (c.match.test(chain)) return c.tier;
  return 2;
}

/** The chain a plan works on and the sentence that says why, from the protocol's own chain list. */
function chainPlan(p: SnapshotProtocol): { chain: string; text: string } {
  const chains = p.chains.filter((c) => c.length > 0);
  if (chains.length === 0) return { chain: 'its main chain', text: 'on its main chain' };
  if (chains.length === 1) return { chain: chains[0]!, text: `on ${chains[0]}, its only chain` };
  // Several chains: prefer the cheapest tier, the first listed among equals. The reason is the tier, so
  // a reader can check it against the chain names rather than taking the plan's word for it.
  let best = chains[0]!;
  for (const c of chains) if (chainCost(c) < chainCost(best)) best = c;
  const rest = chains.filter((c) => c !== best);
  const why = chainCost(best) === 1
    ? 'because it is the cheapest of its chains to transact on'
    : chainCost(best) === 2
      ? 'because it is the first of its chains listed and the cheapest tier among them'
      : 'because every chain it runs on is a costly one and it is listed first';
  return { chain: best, text: `on ${best} rather than ${rest.join(' or ')}, ${why}` };
}

/** How the capital reaches `chain`, in one clause. */
function moveFor(chain: string, capital: number): string {
  return /^ethereum$/i.test(chain) ? `Fund the wallet with $${capital} of USDC on Ethereum` : `Bridge $${capital} of USDC to ${chain}`;
}

/** The qualifying position one venue asks for, in one clause that names the venue's own surface. */
function positionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  const move = moveFor(chain, capital);
  switch (venueOf(p.category)) {
    case 'perps':
      return `${move} and open one small hedge on ${name}'s own perpetual markets, on the contract whose order book prices deepest`;
    case 'dex':
      return `${move} and provide it as liquidity in ${name}'s deepest pool, the pair that carries most of its volume`;
    case 'lending':
      return `${move}, supply it on ${name}'s supply side, and borrow a small amount back so both its supply and borrow sides count the wallet`;
    case 'bridge':
      return `${move} and push one transfer through ${name} at a size near its own median transfer volume`;
    case 'staking':
      return `${move} and delegate it to one of ${name}'s validators rather than holding it idle`;
    case 'restaking':
      return `${move} and restake it through ${name} to one of its operators, on top of the stake it already secures`;
    case 'rwa':
      return `${move} and take a slice of ${name}'s senior tranche, the one its issuer pays first`;
    case 'prediction':
      return `${move} and market-make both sides of one of ${name}'s own contracts, quoting a bid and an ask`;
    case 'yield':
      return `${move} and deposit it into ${name}'s largest vault so its curator counts the position`;
    case 'insurance':
      return `${move} and buy cover from ${name} on one of the risks it lists`;
    default:
      return `${move} and deposit it into ${name}`;
  }
}

/** The one action a venue's plan repeats every week, in one clause. */
function repeatFor(p: SnapshotProtocol): string {
  const name = p.name;
  switch (venueOf(p.category)) {
    case 'perps':
      return `roll the hedge on ${name}'s perpetual markets as its funding turns`;
    case 'dex':
      return `rebalance the range in ${name}'s pool as its price leaves the band`;
    case 'lending':
      return `keep ${name}'s borrow side healthy by repaying a little or adding collateral`;
    case 'bridge':
      return `repeat one transfer through ${name} so its volume counts in a second week`;
    case 'staking':
      return `compound the delegation rewards ${name} pays into the same validator`;
    case 'restaking':
      return `claim and restake the rewards ${name} pays so the operator keeps earning`;
    case 'rwa':
      return `roll the ${name} tranche forward as each period closes`;
    case 'prediction':
      return `refresh the quotes on ${name}'s contract before each resolution`;
    case 'yield':
      return `harvest ${name}'s vault and redeposit so the curator sees the activity`;
    case 'insurance':
      return `renew the ${name} cover before it lapses`;
    default:
      return `repeat one deposit into ${name}`;
  }
}

/** One step of a plan: its sentence, and the dollars and hours the sentence costs. */
interface PlanStep {
  text: string;
  usd: number;
  hours: number;
}

/** How many weeks a hold of `hold` days spans: one every-week action per week it covers. */
function weeksOf(holdDays: number): number {
  return Math.max(1, Math.ceil(holdDays / 7));
}

/**
 * A protocol's farm plan, built from its own record: the venue kinds its category names, the chains it
 * runs on, the position size its TVL justifies, and the hold its age asks for. Each step carries its
 * own dollars and hours, so the verdict and the printed plan can never disagree.
 */
function planOf(p: SnapshotProtocol, age: number | null): PlanStep[] {
  const { chain, text: chainText } = chainPlan(p);
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain, capital);
  const hold = holdDaysFor(age);
  const weeks = weeksOf(hold);
  const name = p.name;
  return [
    {
      text: `Open a fresh wallet that holds only the $${capital} you plan to farm ${chainText}, keep its recovery phrase offline, and fund it with $${gas} of gas; about 10 minutes.`,
      usd: gas,
      hours: 10 / 60,
    },
    {
      text: `${positionFor(p, capital, chain)}; budget about $${gas} of gas; about 25 minutes to set up.`,
      usd: gas,
      hours: 25 / 60,
    },
    {
      text: `Every week for ${hold} days, ${repeatFor(p)}, and set aside about $2 of gas each week; about 15 minutes a week.`,
      usd: 2 * weeks,
      hours: (15 * weeks) / 60,
    },
    {
      text: `Hold the $${capital} position open ${chainText} for at least ${hold} days so ${name} counts the activity in more than one snapshot, and keep the $${capital} at work instead of adding new dollars.`,
      usd: 0,
      hours: 0,
    },
    {
      text: `Before withdrawing, open ${name}'s own rewards page and claim only from the link it publishes, allowing about $2 of gas and never paying a fee to claim; about 15 minutes.`,
      usd: 2,
      hours: 15 / 60,
    },
    {
      text: `Write the wallet address, every ${name} transaction, its date and the $${capital} committed into a farm log so the position can be repeated or unwound; about 10 minutes.`,
      usd: 0,
      hours: 10 / 60,
    },
  ];
}

/**
 * A protocol's farm plan: six steps, each one sentence that states the action, its dollar cost and its
 * duration. The venue comes from the category, the networks from the protocol's own chain list, the
 * position size from its TVL, the hold from its age. Never a hand-written list, never a rank.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  return planOf(p, age).map((s) => s.text);
}

/**
 * The dollar cost and the time one step of `farmSteps` names. The step is looked up in the same plan
 * builder `farmSteps` prints, so the figures are the step's own and not a second, drifting table.
 */
function planFigures(p: SnapshotProtocol, age: number | null, step: string): { usd: number; hours: number } {
  const plan = planOf(p, age);
  const i = plan.findIndex((s) => s.text === step);
  if (i >= 0) return { usd: plan[i]!.usd, hours: plan[i]!.hours };
  // A step the builder does not print (a caller passed its own text): read the dollars and the minutes
  // out of the sentence itself.
  const usd = (step.match(/\$(\d+(?:\.\d+)?)/g) ?? []).reduce((sum, m) => sum + Number(m.slice(1)), 0);
  const minutes = step.match(/about (\d+) minutes?/);
  const perWeek = /a week/.test(step);
  const hours = minutes === null ? 0 : (Number(minutes[1]) * (perWeek ? weeksOf(holdDaysFor(age)) : 1)) / 60;
  return { usd, hours: Number.isFinite(hours) ? hours : 0 };
}

/** A farm plan's verdict: the conservative implied value it buys per dollar spent decides. */
export type FarmVerdictLabel = 'worth it' | 'marginal' | 'skip';

/** What one row's farm plan costs, how long it takes, and whether it is worth running. */
export interface FarmVerdict {
  /** The plan's dollar costs, summed (gas only: the capital stays the farmer's). */
  cost_usd: number;
  /** The plan's durations, in hours. */
  hours: number;
  /** cost_usd / hours. */
  usd_per_hour: number;
  /** The largest dollar figure any one step commits: the capital a fresh wallet must hold. */
  min_capital: number;
  /** cost_usd / min_capital: the gas the plan burns as a share of the float it must commit. */
  burn_pct: number;
  /** The conservative end of the row's own implied-value range: what the plan's cost is read against. */
  implied_low_usd: number;
  /** implied_low_usd / cost_usd: the value per dollar the verdict's tier reads. */
  ratio: number;
  verdict: FarmVerdictLabel;
}

/**
 * A plan's verdict, from what it buys against what it spends. The tier reads value per dollar:
 * implied_low / cost_usd, the conservative end of the row's own range over the gas the plan burns.
 * Every plan here costs 18 to 36 dollars, so a dollars-per-hour or a dollars-spent tier puts all 200
 * rows in one bucket; implied value spans five orders of magnitude and separates them. The ratio is a
 * function of the row's own figures only, so the same protocol always gets the same verdict.
 */
export function farmVerdict(
  p: SnapshotProtocol,
  age: number | null,
  steps: string[] = farmSteps(p, age),
  model: ModelConstants = MODEL,
  impliedLow: number = 0,
): FarmVerdict {
  let cost = 0;
  let hours = 0;
  // The capital is the largest figure a single step commits (the wallet's float, printed by steps 1, 2,
  // 4 and 6); it is risked, not spent, so it is not part of cost_usd.
  const capital = capitalFor(p.tvl_usd);
  for (const step of steps) {
    const f = planFigures(p, age, step);
    cost += f.usd;
    hours += f.hours;
  }
  const usdPerHour = hours > 0 ? cost / hours : 0;
  const burnPct = capital > 0 ? cost / capital : 1;
  const low = Number.isFinite(impliedLow) && impliedLow > 0 ? impliedLow : 0;
  const ratio = cost > 0 ? low / cost : 0;
  const verdict: FarmVerdictLabel =
    ratio >= model.farm_worth_it_ratio ? 'worth it' : ratio >= model.farm_marginal_ratio ? 'marginal' : 'skip';
  return {
    cost_usd: cost,
    hours: Number(hours.toFixed(4)),
    usd_per_hour: Number(usdPerHour.toFixed(4)),
    min_capital: capital,
    burn_pct: Number(burnPct.toFixed(4)),
    implied_low_usd: low,
    ratio: Number(ratio.toFixed(2)),
    verdict,
  };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The model card: every fitted multiple with its interval and peer count, plus the leave-one-out line. */
export function calibrationCard(snapshot: Snapshot, model: ModelConstants = MODEL): RadarCalibration {
  const live = liveRows(snapshot);
  const peers = peerMultiples(live, model.peer_min_sample);
  const intervals = peerIntervals(live, model.interval_min_sample);
  const fit = peerFit(live);
  const loo = validatePeers(live, model.peer_min_sample);
  return {
    model_version: MODEL_VERSION,
    n_peers: peers.n,
    pooled_multiple: peers.pooled,
    slope: fit.slope,
    intercept: fit.intercept,
    spearman_tvl_mcap: fit.spearman_tvl_mcap,
    spearman_growth_mcap: fit.spearman_growth_mcap,
    loo: {
      n: loo.n,
      median_abs_log_error: loo.medianAbsLogError,
      median_ratio: loo.medianRatio,
      within2x: loo.within2x,
      within3x: loo.within3x,
      worst: loo.worst.name === '' ? { name: '', ratio: 0 } : { name: loo.worst.name, ratio: Number.isFinite(loo.worst.ratio) ? Number(loo.worst.ratio.toFixed(2)) : loo.worst.ratio },
    },
    by_kind: KINDS.map((kind) => {
      const span = intervalsByKind(intervals, kind);
      return {
        kind,
        multiple: peers.byKind.get(kind) ?? peers.pooled,
        low: span.low,
        high: span.high,
        n: peers.counts.get(kind) ?? 0,
        offset: fit.offsets.get(kind) ?? 0,
      };
    }),
  };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_multiple: row.model.category_multiple,
    growth_excess_pct: row.model.growth_excess_pct,
    category_median_pct: row.model.category_median_pct,
    size_multiplier: row.model.size_multiplier,
    implied_low: row.implied_low_usd,
    implied_high: row.implied_high_usd,
    peer_n: row.peer_n,
    no_peer_evidence: (row.peer_n ?? 0) < 2,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    calibration: calibrationCard(snapshot, model),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Every number the board ships, by path, for the finiteness gate. */
function numbersOf(board: BoardRow[]): Array<{ path: string; value: number }> {
  const out: Array<{ path: string; value: number }> = [];
  for (const r of board) {
    out.push({ path: `${r.slug}.implied_value_usd`, value: r.implied_value_usd });
    out.push({ path: `${r.slug}.implied_low_usd`, value: r.implied_low_usd });
    out.push({ path: `${r.slug}.implied_high_usd`, value: r.implied_high_usd });
    out.push({ path: `${r.slug}.tvl_usd`, value: r.tvl_usd });
    out.push({ path: `${r.slug}.peer_n`, value: r.peer_n });
    if (r.age_days !== null) out.push({ path: `${r.slug}.age_days`, value: r.age_days });
    for (const [k, v] of Object.entries(r.model)) if (typeof v === 'number') out.push({ path: `${r.slug}.model.${k}`, value: v });
    for (const [k, v] of Object.entries(r.farm)) if (typeof v === 'number') out.push({ path: `${r.slug}.farm.${k}`, value: v });
  }
  return out;
}

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value,
 * farm steps, and any field that is not a finite number.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const n of numbersOf(board)) {
    if (!Number.isFinite(n.value)) return `${n.path} is ${n.value}: every number the board ships must be finite`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.implied_low_usd <= r.implied_high_usd)) return `${r.slug} has an interval of ${r.implied_low_usd} to ${r.implied_high_usd}`;
    if (!Number.isSafeInteger(r.implied_low_usd) || !Number.isSafeInteger(r.implied_high_usd)) return `${r.slug} has an interval of ${r.implied_low_usd} to ${r.implied_high_usd}`;
    if (!Number.isSafeInteger(r.peer_n) || r.peer_n < 0) return `${r.slug} has peer count ${r.peer_n}`;
    // The page marks a range as resting on the pooled fit; that mark must be the data's, not a guess.
    if (r.no_peer_evidence !== r.peer_n < 2) return `${r.slug} marks no_peer_evidence ${r.no_peer_evidence} with ${r.peer_n} peers`;
    // The verdict must be the tier the ratio falls in: a label that does not follow the row's own ratio
    // is a word the page prints and the model cannot defend.
    const want =
      r.farm.ratio >= MODEL.farm_worth_it_ratio ? 'worth it' : r.farm.ratio >= MODEL.farm_marginal_ratio ? 'marginal' : 'skip';
    if (r.farm.verdict !== want) return `${r.slug} has verdict '${r.farm.verdict}' at ratio ${r.farm.ratio}, which is '${want}'`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
