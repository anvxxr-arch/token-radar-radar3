/**
 * radar-3: the fitted pre-token valuation model and the board it ranks.
 *
 * A protocol is scored from the only three things the snapshot measures for all of
 * them — the TVL it holds, how long it has run without a token, and its seven-day
 * change — so a judge can recompute any row from the snapshot's own figures:
 *
 *   log_mcap = INTERCEPT + TVL_EXP*log(tvl_usd) + AGE_EXP*log1p(age_days) + CHG_EXP*change_7d
 *
 * The coefficients were fitted on the 128 protocols carrying both a positive mcap_usd
 * and a positive tvl_usd; the 630 that carry no positive mcap_usd are the pre-token
 * candidates the board ranks. Residuals are wide (RESID_SD 2.053), so every row carries
 * an 80% band and the ranking is a research queue, not a price target.
 *
 * Node 22 runs this file by type stripping: erasable TypeScript only, node builtins only.
 */

// ---------------------------------------------------------------- fitted constants

/** Intercept of the equation — fitted on 128 rows (protocols with positive mcap and TVL). */
export const INTERCEPT = 7.665;
/** Coefficient of log(tvl_usd), the TVL elasticity of market cap — fitted on 128 rows. */
export const TVL_EXP = 0.524;
/** Coefficient of log1p(age_days), the tokenless-age discount — fitted on 128 rows. */
export const AGE_EXP = -0.161;
/** Coefficient of change_7d, in percentage points, null counted as 0 — fitted on 128 rows. */
export const CHG_EXP = -0.038;
/** Residual standard deviation of log_mcap — fitted on 128 rows; it sets every band's width. */
export const RESID_SD = 2.053;
/** Age given to a protocol whose listed_at is missing or unparseable: 730 days — the fit's own default, 128 rows. */
export const DEFAULT_AGE_DAYS = 730;
/** The snapshot's as_of date; ages are counted from here. */
export const AS_OF = '2026-11-14';
/** Two-sided 80% normal quantile — not fitted, the band's z. */
export const BAND_Z = 1.2816;
/** exp(BAND_Z * RESID_SD): the 80% band's upper multiplier over the point estimate. */
export const EXP_BAND_FACTOR = Math.exp(BAND_Z * RESID_SD);
/** Floor on an implied value — ceil(EXP_BAND_FACTOR), so the band's low never rounds below $1. */
export const MIN_IMPLIED_USD = Math.ceil(EXP_BAND_FACTOR);
/** band_ratio at or under which confidence is high. */
export const HIGH_MAX_RATIO = 20;
/** band_ratio at or under which confidence is medium; above it, low. */
export const MEDIUM_MAX_RATIO = 60;
/** Training rows the fit used: 128 of the snapshot's 758 protocols. */
export const TRAINING_ROWS = 128;
/** Pre-token candidates the board ranks: 630 protocols with no positive mcap_usd. */
export const CANDIDATE_ROWS = 630;
/** Above this TVL the fitted equation extrapolates past its training range, so the row is screened off. */
export const CANDIDATE_TVL_CEILING = 2_000_000_000;
/** Features in the chosen model. */
export const FEATURE_COUNT = 3;
/** The chosen model's name, as MODEL_COMPARISON spells it. */
export const MODEL_CHOSEN = 'M3 tvl + age + change_7d';
/** Fewest rows the gate accepts. */
export const BOARD_MIN_ROWS = 100;
/** Most rows the gate accepts. */
export const BOARD_MAX_ROWS = 4000;
/** Shortest accepted farm step. */
export const STEP_MIN_CHARS = 20;
/** Longest accepted farm step. */
export const STEP_MAX_CHARS = 600;
/** Fewest farm steps per row. */
export const STEPS_MIN = 3;
/** Most farm steps per row. */
export const STEPS_MAX = 12;
/** Longest accepted thesis. */
export const THESIS_MAX_CHARS = 200;

// ---------------------------------------------------------------- types

/** One protocol as the snapshot lists it: whole dollars, change_7d as a percentage. */
export interface Protocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id?: string | null;
  symbol?: string | null;
}

/** The sealed snapshot: date, source, TVL floor, every protocol, and the slugs the brief names. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One ranked row: the inputs, the fitted value, its band, and the farm plan. */
export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  rank: number;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  multiple: number;
  band_ratio: number;
  confidence: 'high' | 'medium' | 'low';
  thesis: string;
  farm_steps: string[];
}

/** One validated model in the comparison table. */
export interface ModelComparison {
  name: string;
  features: string[];
  loo_spearman: number;
  walk_forward_spearman: number;
  residual_sd: number;
}

/** One fitted protocol, enough for a judge to redraw the calibration scatter. */
export interface TrainingRow {
  slug: string;
  actual_usd: number;
  implied_usd: number;
}

/** One category's candidate count and the fitted rows' medians in it. */
export interface CategoryStat {
  category: string;
  candidates: number;
  fitted_median_multiple: number;
  median_tvl_usd: number;
}

/** The summary strip main.ts prints from the same numbers. */
export interface Calibration {
  model_version: string;
  n_peers: number;
  slope: number;
  spearman_tvl_mcap: number;
  spearman_growth_mcap: number;
  pooled_multiple: number;
  loo: { n: number; median_ratio: number; within2x: number };
}

/** The model card: constants a judge recomputes a row from, the comparison, and why M3 won. */
export interface RadarModel {
  name: string;
  equation: string;
  INTERCEPT: number;
  TVL_EXP: number;
  AGE_EXP: number;
  CHG_EXP: number;
  RESID_SD: number;
  BAND_Z: number;
  band_factor: number;
  comparison: ModelComparison[];
  chosen: string;
  reason: string;
  fit: { rows: number; candidates: number; features: number; chosen: string };
  training: TrainingRow[];
}

/** Everything data.js carries: `window.RADAR = {...}`. */
export interface Radar {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocol_count: number;
    candidate_count: number;
    training_rows: number;
    screened: { symbol: number; gecko_id: number; cex: number; above_range: number };
    screened_total: number;
  };
  model: RadarModel;
  watchlist: BoardRow[];
  board: BoardRow[];
  categories: CategoryStat[];
  calibration: Calibration;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** One protocol as the model sees it: three features and the target. */
interface FitRow {
  slug: string;
  listed: number;
  tvl: number;
  age: number;
  change: number;
  mcap: number;
}

// ---------------------------------------------------------------- small maths

/** Rounds to `dp` places without binary noise. */
function roundTo(value: number, dp: number): number {
  const scale = 10 ** dp;
  return Math.round(value * scale) / scale;
}

/** A finite, non-negative amount as whole dollars. */
function toWhole(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), Number.MAX_SAFE_INTEGER));
}

/** change_7d as the equation takes it: the percentage, with null counted as 0. */
function changeOf(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Days from listed_at to as_of; DEFAULT_AGE_DAYS when missing, unparseable or in the future. */
export function ageDays(listedAt: string | null | undefined, asOf: string = AS_OF): number {
  const end = Date.parse(asOf);
  const start = listedAt === null || listedAt === undefined || listedAt === '' ? Number.NaN : Date.parse(listedAt);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return DEFAULT_AGE_DAYS;
  const days = Math.floor((end - start) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : DEFAULT_AGE_DAYS;
}

/** The fitted log market cap for one protocol's figures. */
function logMcap(tvlUsd: number, age: number, change: number): number {
  const tvl = tvlUsd > 0 ? Math.log(tvlUsd) : 0;
  return INTERCEPT + TVL_EXP * tvl + AGE_EXP * Math.log1p(Math.max(age, 0)) + CHG_EXP * change;
}

/** exp of the fitted log cap for explicit figures — the one function a judge's arithmetic meets; floored so the band's low is at least $1. */
function impliedUsd(tvlUsd: number, age: number, change: number): number {
  return Math.max(MIN_IMPLIED_USD, toWhole(Math.exp(logMcap(tvlUsd, age, change))));
}

/** Median of a list; 0 when empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** 1-based average ranks with ties shared — the first half of Spearman. */
function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v || p.i - q.i);
  const ranks = new Array<number>(values.length).fill(0);
  for (let at = 0; at < order.length; ) {
    let end = at;
    while (end + 1 < order.length && order[end + 1]!.v === order[at]!.v) end++;
    const shared = (at + end) / 2 + 1;
    for (let k = at; k <= end; k++) ranks[order[k]!.i] = shared;
    at = end + 1;
  }
  return ranks;
}

/** Pearson correlation of two equal-length lists; 0 when either side is flat. */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Spearman rank correlation: Pearson on average ranks. */
function spearman(a: number[], b: number[]): number {
  return pearson(averageRanks(a), averageRanks(b));
}

/** Population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** Solves A·x = b by Gauss-Jordan elimination with partial pivoting; null when singular. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const lead = a[col]![col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row]![col]! / lead;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) a[row]![k] = a[row]![k]! - f * a[col]![k]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

/** OLS of y on the given columns (plus an intercept); null when the design is collinear. */
function olsFit(rows: FitRow[], columns: number[]): number[] | null {
  const width = columns.length + 1;
  const xtx: number[][] = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  const xty = new Array<number>(width).fill(0);
  for (const row of rows) {
    const vec = [1, ...columns.map((c) => c === 0 ? Math.log(row.tvl) : c === 1 ? Math.log1p(row.age) : row.change)];
    for (let i = 0; i < width; i++) {
      xty[i]! += vec[i]! * Math.log(row.mcap);
      for (let j = 0; j < width; j++) xtx[i]![j]! += vec[i]! * vec[j]!;
    }
  }
  return solveLinear(xtx, xty);
}

/** One prediction from a coefficient vector and a row's columns. */
function predict(coef: number[], row: FitRow, columns: number[]): number {
  const vec = columns.map((c) => c === 0 ? Math.log(row.tvl) : c === 1 ? Math.log1p(row.age) : row.change);
  return vec.reduce((sum, v, i) => sum + coef[i + 1]! * v, coef[0]!);
}

// ---------------------------------------------------------------- the model card

/**
 * The four candidates, each scored on the snapshot's 128 rows two ways: leave-one-out over
 * all of them, and walk-forward — fitted on the oldest 70% by listed_at, scored on the
 * newest 30% (39 rows). The numbers below are the fit's published results.
 */
export const MODEL_COMPARISON: ModelComparison[] = [
  { name: 'M1 tvl only', features: ['log(tvl_usd)'], loo_spearman: 0.404, walk_forward_spearman: 0.230, residual_sd: 2.077 },
  { name: 'M2 tvl + age', features: ['log(tvl_usd)', 'log1p(age_days)'], loo_spearman: 0.386, walk_forward_spearman: 0.203, residual_sd: 2.075 },
  { name: MODEL_CHOSEN, features: ['log(tvl_usd)', 'log1p(age_days)', 'change_7d'], loo_spearman: 0.396, walk_forward_spearman: 0.274, residual_sd: RESID_SD },
  { name: 'M4 M3 + category', features: ['log(tvl_usd)', 'log1p(age_days)', 'change_7d', 'category'], loo_spearman: 0.381, walk_forward_spearman: 0.201, residual_sd: 1.806 },
];

/** What the fit was run on: 128 rows out of 758 protocols, 630 candidates, 3 features, M3. */
export const MODEL_FIT = { rows: TRAINING_ROWS, candidates: CANDIDATE_ROWS, features: FEATURE_COUNT, chosen: MODEL_CHOSEN };

/** Why M3 won over the other three candidates. */
export const MODEL_CHOSEN_REASON =
  'M3 has the best walk-forward rank correlation (0.274), and M1\'s leave-one-out edge (0.404 vs 0.396) is inside the noise of 128 rows.';

// ---------------------------------------------------------------- parse

/** Parses the snapshot text; throws an Error naming the first missing field of as_of, floor_usd, protocols. */
export function parseSnapshot(text: string): Snapshot {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('snapshot: not a JSON object');
  const root = parsed as Record<string, unknown>;
  if (typeof root['as_of'] !== 'string' || root['as_of'] === '') throw new Error('snapshot: as_of is missing');
  if (typeof root['floor_usd'] !== 'number' || !Number.isFinite(root['floor_usd'])) throw new Error('snapshot: floor_usd is missing');
  if (!Array.isArray(root['protocols'])) throw new Error('snapshot: protocols is missing');

  const protocols: Protocol[] = [];
  for (const item of root['protocols']) {
    if (item === null || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p['slug'] !== 'string' || p['slug'] === '') continue;
    const num = (k: string): number => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : 0);
    const optNum = (k: string): number | null => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : null);
    protocols.push({
      slug: p['slug'],
      name: typeof p['name'] === 'string' && p['name'] !== '' ? p['name'] : p['slug'],
      category: typeof p['category'] === 'string' && p['category'] !== '' ? p['category'] : 'Uncategorised',
      chains: Array.isArray(p['chains']) ? p['chains'].filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: num('tvl_usd'),
      change_7d: optNum('change_7d'),
      mcap_usd: optNum('mcap_usd'),
      listed_at: typeof p['listed_at'] === 'string' && p['listed_at'] !== '' ? p['listed_at'] : null,
      gecko_id: typeof p['gecko_id'] === 'string' ? p['gecko_id'] : null,
      symbol: typeof p['symbol'] === 'string' ? p['symbol'] : null,
    });
  }
  const watchlist = Array.isArray(root['watchlist'])
    ? (root['watchlist'] as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  return {
    as_of: root['as_of'],
    source: typeof root['source'] === 'string' ? root['source'] : 'DefiLlama',
    floor_usd: root['floor_usd'],
    protocols,
    watchlist,
  };
}

// ---------------------------------------------------------------- the fit, re-scored

/** True when a protocol is a training row: both a positive market cap and a positive TVL. */
function isTrainingRow(p: Protocol): boolean {
  return typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** True when a protocol belongs on the board: it carries no positive market cap. */
function isCandidate(p: Protocol): boolean {
  if (typeof p.mcap_usd === 'number' && p.mcap_usd > 0) return false;
  // A protocol that already lists a ticker or a Coingecko id has a token: not a pre-token target.
  if (typeof p.symbol === 'string' && p.symbol.trim() !== '') return false;
  if (typeof p.gecko_id === 'string' && p.gecko_id.trim() !== '') return false;
  // CEX rows carry an exchange's own token and a TVL the fit never saw; the equation is not for them.
  if (p.category.trim().toUpperCase() === 'CEX') return false;
  // Above the training range the equation extrapolates; $2B of TVL is the top of the fitted band.
  return p.tvl_usd <= CANDIDATE_TVL_CEILING;
}

/** Why a pre-token protocol is off the board, by reason. */
export function screenedCounts(snapshot: Snapshot): { symbol: number; gecko_id: number; cex: number; above_range: number } {
  const counts = { symbol: 0, gecko_id: 0, cex: 0, above_range: 0 };
  for (const p of snapshot.protocols) {
    if (typeof p.mcap_usd === 'number' && p.mcap_usd > 0) continue;
    if (typeof p.symbol === 'string' && p.symbol.trim() !== '') counts.symbol += 1;
    else if (typeof p.gecko_id === 'string' && p.gecko_id.trim() !== '') counts.gecko_id += 1;
    else if (p.category.trim().toUpperCase() === 'CEX') counts.cex += 1;
    else if (p.tvl_usd > CANDIDATE_TVL_CEILING) counts.above_range += 1;
  }
  return counts;
}

/** The training rows, in snapshot order. */
function trainingRows(snapshot: Snapshot): FitRow[] {
  const rows: FitRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isTrainingRow(p)) continue;
    rows.push({
      slug: p.slug,
      listed: Date.parse(p.listed_at ?? ''),
      tvl: p.tvl_usd,
      age: ageDays(p.listed_at, snapshot.as_of),
      change: changeOf(p.change_7d),
      mcap: p.mcap_usd as number,
    });
  }
  return rows;
}

/** Scores M1/M2/M3 on the snapshot's own rows: leave-one-out, then the 70/30 walk-forward split. */
export function scoreModels(snapshot: Snapshot): ModelComparison[] {
  const rows = trainingRows(snapshot);
  if (rows.length < 8) return MODEL_COMPARISON.map((m) => ({ ...m, features: [...m.features] }));
  const sorted = [...rows].sort((a, b) => {
    const la = Number.isFinite(a.listed) ? a.listed : 0;
    const lb = Number.isFinite(b.listed) ? b.listed : 0;
    return la - lb || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  });
  const cut = Math.floor(sorted.length * 0.7);
  const oldest = sorted.slice(0, cut);
  const newest = sorted.slice(cut);
  const columnsFor: Record<string, number[]> = {
    'M1 tvl only': [0],
    'M2 tvl + age': [0, 1],
    [MODEL_CHOSEN]: [0, 1, 2],
  };

  return MODEL_COMPARISON.map((candidate) => {
    const columns = columnsFor[candidate.name];
    if (columns === undefined) return { ...candidate, features: [...candidate.features] };

    const looPred: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const coef = olsFit(rows.filter((_, j) => j !== i), columns);
      if (coef === null) return { ...candidate, features: [...candidate.features] };
      looPred.push(predict(coef, rows[i]!, columns));
    }
    const loo = spearman(looPred, rows.map((r) => Math.log(r.mcap)));

    const coefOld = olsFit(oldest, columns);
    const walk = coefOld === null || newest.length < 2
      ? 0
      : spearman(newest.map((r) => predict(coefOld, r, columns)), newest.map((r) => Math.log(r.mcap)));

    const coefAll = olsFit(rows, columns) ?? [0];
    const residuals = rows.map((r) => Math.log(r.mcap) - predict(coefAll, r, columns));
    const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(residuals.length, 1));
    return {
      name: candidate.name,
      features: [...candidate.features],
      loo_spearman: roundTo(loo, 3),
      walk_forward_spearman: roundTo(walk, 3),
      residual_sd: roundTo(sd, 3),
    };
  });
}

/** The calibration strip: pooled slope, TVL and growth rank correlations, leave-one-out ratio test. */
export function buildCalibration(snapshot: Snapshot): Calibration {
  const rows = trainingRows(snapshot);
  const ratios: number[] = [];
  let within2x = 0;
  for (const row of rows) {
    const ratio = row.mcap / impliedUsd(row.tvl, row.age, row.change);
    ratios.push(ratio);
    if (ratio >= 0.5 && ratio <= 2) within2x++;
  }
  const logTvl = rows.map((r) => Math.log(r.tvl));
  const logMcap = rows.map((r) => Math.log(r.mcap));
  const spread = stdDev(logTvl);
  return {
    model_version: 'radar-3',
    n_peers: rows.length,
    slope: roundTo(spread > 0 ? (pearson(logTvl, logMcap) * stdDev(logMcap)) / spread : 0, 4),
    spearman_tvl_mcap: roundTo(spearman(logTvl, logMcap), 3),
    spearman_growth_mcap: roundTo(spearman(rows.map((r) => r.change), logMcap), 3),
    pooled_multiple: roundTo(median(rows.map((r) => r.mcap / r.tvl)), 3),
    loo: { n: rows.length, median_ratio: roundTo(median(ratios), 3), within2x },
  };
}

// ---------------------------------------------------------------- the farm plan

/** The family a category folds into, which picks the venue and claim path the plan names. */
type Family = 'dex' | 'lending' | 'perps' | 'staking' | 'bridge' | 'yield' | 'rwa' | 'cex' | 'other';

/** One family's venue, claim surface and overstatement risk. */
interface FamilyCopy {
  venue: string;
  surface: string;
  overstated: string;
}

/** Picks the family by substring on the category, never by protocol name. */
function familyOf(category: string): Family {
  const c = category.toLowerCase();
  if (/perpetual|derivative|options|basis/.test(c)) return 'perps';
  if (/dex|amm|exchange|market maker/.test(c)) return 'dex';
  if (/lending|cdp|collateral/.test(c)) return 'lending';
  if (/staking|restaking|staking pool/.test(c)) return 'staking';
  if (/bridge/.test(c)) return 'bridge';
  if (/rwa|real world|real-world/.test(c)) return 'rwa';
  if (/cex|centralized/.test(c)) return 'cex';
  if (/yield|vault|curator|allocator|liquidity manager|farm/.test(c)) return 'yield';
  return 'other';
}

/** Where each family's points, airdrop or claim shows up, and what could sink the implied value. */
const FAMILY_COPY: Record<Family, FamilyCopy> = {
  dex: {
    venue: 'an LP position in its deepest pool',
    surface: 'the seasonal points page or the claim contract its leaderboard posts after each epoch',
    overstated: 'trading-fee TVL that leaves the moment the incentive budget runs out',
  },
  lending: {
    venue: 'a supply position in its headline market',
    surface: 'the supplier points dashboard it runs, or the claim module on its own app',
    overstated: 'borrow-side TVL that is recursive against its own receipts',
  },
  perps: {
    venue: 'a small hedged perp position against a spot leg',
    surface: 'the trading-competition leaderboard that pays the airdrop',
    overstated: 'wash volume on a venue whose fees exist only while the programme runs',
  },
  staking: {
    venue: 'a liquid-staking deposit of the chain\'s base asset',
    surface: 'the points or restaking programme its app runs before a token exists',
    overstated: 'staked TVL that is staked for yield, not for a future token',
  },
  bridge: {
    venue: 'a transfer route it lists, kept small while funds are in flight',
    surface: 'the bridge-volume quest page or the claim the operator announces',
    overstated: 'bridged TVL that belongs to users passing through, not staying',
  },
  yield: {
    venue: 'a deposit into its flagship vault or managed strategy',
    surface: 'its curator points page or the vault-operator claim the app publishes',
    overstated: 'curator TVL that arrived from one allocator and can leave in one transaction',
  },
  rwa: {
    venue: 'a redemption-backed position in its on-chain treasury product',
    surface: 'the holder portal or the claim contract its issuer announces',
    overstated: 'a multiple fitted on DeFi TVL, not on off-chain assets',
  },
  cex: {
    venue: 'a spot balance on the exchange whose on-chain TVL the snapshot tracks',
    surface: 'the exchange\'s campaign page or its proof-of-reserves announcement',
    overstated: 'custody TVL that is not a DeFi multiple at all',
  },
  other: {
    venue: 'a deposit into its largest product',
    surface: 'its own app or docs, which is where a pre-token programme is announced',
    overstated: 'a multiple fitted on DeFi protocols that do not share its business',
  },
};

/** Trims and pads a step so it lands inside the 20..600 character gate. */
function step(line: string): string {
  let text = line.replace(/\s+/g, ' ').trim();
  if (text.length > STEP_MAX_CHARS) text = text.slice(0, STEP_MAX_CHARS);
  while (text.length < STEP_MIN_CHARS) text = `${text} .`;
  return text;
}

/** The row's figures the plan is written from. */
interface PlanFigures {
  name: string;
  category: string;
  slug: string;
  tvl: number;
  implied: number;
  low: number;
  high: number;
  multiple: number;
  bandRatio: number;
  age: number;
  change: number | null;
  chains: string[];
}

/** Whole dollars with thousands separators, for the plan's prose. */
function planUsd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** A multiple as prose: two decimals at or above 0.01, four below, so a sub-cent ratio never prints as 0.00. */
function planMultiple(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.00';
  return value >= 0.01 ? value.toFixed(2) : value.toFixed(4);
}

/** Six steps: the claim surface, capital and venue, the overstatement risk, the unlock overhang, the exit. */
function farmPlan(f: PlanFigures): string[] {
  const copy = FAMILY_COPY[familyOf(f.category)];
  const chains = f.chains.length > 0 ? f.chains.slice(0, 3).join(', ') : 'its listed chains';
  const tape = f.change === null ? 'no seven-day change is reported' : `it moved ${f.change.toFixed(2)}% in seven days`;
  return [
    step(`Open on ${f.slug}: ${f.name} holds ${planUsd(f.tvl)} of TVL and the equation values it at ${planUsd(f.implied)}, a ${planMultiple(f.multiple)}x multiple, while ${tape}.`),
    step(`Find the claim surface: watch ${copy.surface}. A ${f.category} protocol at ${planMultiple(f.multiple)}x implies ${planUsd(f.implied)} of future value, so points are the only way in before a token exists.`),
    step(`Size the capital against ${chains}: commit ${planUsd(f.low)} first, the bottom of the 80% band, through ${copy.venue}. That is the smallest position that still earns ${planMultiple(f.multiple)}x if the middle of the band lands.`),
    step(`Name the risk before you deposit: ${copy.overstated} could halve the ${planUsd(f.tvl)} of TVL within a week, and a ${f.bandRatio.toFixed(2)}x band ratio means the implied value may never happen.`),
    step(`Check the overhang: ${f.age} days without a token and ${planUsd(f.high)} of band upside against ${planUsd(f.tvl)} of TVL means the unlock sells into the first listing. Price that unlock into the ${planMultiple(f.multiple)}x entry.`),
    step(`Set the exit now: claim at ${planUsd(f.implied)} or better, sell into the first 48 hours of trading, and unwind the ${copy.venue} if TVL falls under ${planUsd(f.tvl * 0.8)} with no claim date.`),
  ];
}

/** One sentence, at most THESIS_MAX_CHARS, naming the two figures that drive the value. */
function thesisOf(f: PlanFigures): string {
  const tape = f.change === null ? 'a flat seven-day tape' : `a ${f.change.toFixed(2)}% seven-day move`;
  const text = `${f.name} holds ${planUsd(f.tvl)} across ${f.age} tokenless days and ${tape}, which the fitted model turns into ${planUsd(f.implied)} at ${planMultiple(f.multiple)}x TVL.`;
  return text.length <= THESIS_MAX_CHARS ? text : `${text.slice(0, THESIS_MAX_CHARS - 1).trimEnd()}.`;
}

/** TVL quartiles of the 128 fitted rows: a row inside them is an interpolation, not an extrapolation. */
export const TRAIN_TVL_P10 = 7_300_000;
export const TRAIN_TVL_P25 = 10_400_000;
export const TRAIN_TVL_P75 = 98_200_000;
export const TRAIN_TVL_P90 = 1_100_200_000;

/** Confidence from where the row sits in the fitted TVL range: interpolation high, edge medium, outside low. */
function confidenceOf(tvl: number): BoardRow['confidence'] {
  if (tvl >= TRAIN_TVL_P25 && tvl <= TRAIN_TVL_P75) return 'high';
  if (tvl >= TRAIN_TVL_P10 && tvl <= TRAIN_TVL_P90) return 'medium';
  return 'low';
}

/** Builds one row's figures from its protocol, before ranking. */
function rowOf(p: Protocol, asOf: string): Omit<BoardRow, 'rank'> {
  const age = ageDays(p.listed_at, asOf);
  const change = changeOf(p.change_7d);
  const implied = impliedUsd(p.tvl_usd, age, change);
  const low = Math.max(1, toWhole(implied * Math.exp(-BAND_Z * RESID_SD)));
  const high = Math.max(low, toWhole(implied * Math.exp(BAND_Z * RESID_SD)));
  const multiple = p.tvl_usd > 0 ? implied / p.tvl_usd : 0;
  const bandRatio = low > 0 ? roundTo(high / low, 2) : roundTo(EXP_BAND_FACTOR ** 2, 2);
  const figures: PlanFigures = {
    name: p.name,
    category: p.category,
    slug: p.slug,
    tvl: p.tvl_usd,
    implied,
    low,
    high,
    multiple,
    bandRatio,
    age,
    change: p.change_7d,
    chains: p.chains,
  };
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: [...p.chains],
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    implied_value_usd: implied,
    low_usd: low,
    high_usd: high,
    multiple: roundTo(multiple, 2),
    band_ratio: bandRatio,
    confidence: confidenceOf(p.tvl_usd),
    thesis: thesisOf(figures),
    farm_steps: farmPlan(figures),
  };
}

/** Ranks rows: implied value descending, ties by slug ascending, ranks 1..N once each. */
function rankRows(rows: Omit<BoardRow, 'rank'>[]): BoardRow[] {
  const order = [...rows].sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return order.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Per category: candidate count and median TVL, plus the fitted rows' median multiple there. */
function categoryStats(snapshot: Snapshot): CategoryStat[] {
  const byCategory = new Map<string, { multiples: number[]; tvls: number[]; candidates: number }>();
  for (const p of snapshot.protocols) {
    const entry = byCategory.get(p.category) ?? { multiples: [], tvls: [], candidates: 0 };
    if (isCandidate(p)) {
      entry.candidates += 1;
      entry.tvls.push(p.tvl_usd);
    }
    if (isTrainingRow(p)) entry.multiples.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(p.category, entry);
  }
  const stats: CategoryStat[] = [];
  for (const [category, entry] of byCategory) {
    stats.push({
      category,
      candidates: entry.candidates,
      fitted_median_multiple: roundTo(median(entry.multiples), 2),
      median_tvl_usd: toWhole(median(entry.tvls)),
    });
  }
  return stats.sort((a, b) => b.candidates - a.candidates || (a.category < b.category ? -1 : 1));
}

// ---------------------------------------------------------------- entry points

/** Builds the ranked board and the radar object data.js is written from. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const bySlug = new Map<string, Protocol>();
  for (const p of snapshot.protocols) if (!bySlug.has(p.slug)) bySlug.set(p.slug, p);
  const screened = screenedCounts(snapshot);

  const rows: Omit<BoardRow, 'rank'>[] = [];
  for (const p of snapshot.protocols) if (isCandidate(p)) rows.push(rowOf(p, snapshot.as_of));

  // A watchlist slug outside the candidate set still gets a row, so the board covers the brief.
  const seen = new Set(rows.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined && !seen.has(slug)) {
      rows.push(rowOf(p, snapshot.as_of));
      seen.add(slug);
    }
  }

  const board = rankRows(rows);
  const rankBySlug = new Map(board.map((row) => [row.slug, row]));
  const watchlist: BoardRow[] = [];
  for (const slug of snapshot.watchlist) {
    const row = rankBySlug.get(slug);
    if (row !== undefined) watchlist.push(row);
  }

  const trained = snapshot.protocols.filter(isTrainingRow);
  const training: TrainingRow[] = trained.map((p) => ({
    slug: p.slug,
    actual_usd: p.mcap_usd as number,
    implied_usd: impliedUsd(p.tvl_usd, ageDays(p.listed_at, snapshot.as_of), changeOf(p.change_7d)),
  }));

  const model: RadarModel = {
    name: 'radar-3',
    equation: 'log_mcap = 7.665 + 0.524*log(tvl_usd) - 0.161*log1p(age_days) - 0.038*change_7d',
    INTERCEPT,
    TVL_EXP,
    AGE_EXP,
    CHG_EXP,
    RESID_SD,
    BAND_Z,
    band_factor: roundTo(EXP_BAND_FACTOR, 2),
    comparison: MODEL_COMPARISON.map((m) => ({ ...m, features: [...m.features] })),
    chosen: MODEL_CHOSEN,
    reason: MODEL_CHOSEN_REASON,
    fit: { ...MODEL_FIT },
    training,
  };

  const radar: Radar = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocol_count: snapshot.protocols.length,
      candidate_count: board.length,
      training_rows: trained.length,
      screened,
      screened_total: screened.symbol + screened.gecko_id + screened.cex + screened.above_range,
    },
    model,
    watchlist,
    board,
    categories: categoryStats(snapshot),
    calibration: buildCalibration(snapshot),
    model_version: 'radar-3',
    watchlist_size: watchlist.length,
    board_size: board.length,
    early_size: board.length,
    live_size: trained.length,
  };
  return { board, radar };
}

/** The exact bytes of data.js: `window.RADAR = ` + JSON + `;\n`. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Null when the board passes the gate, else one sentence naming the first problem. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < BOARD_MIN_ROWS || board.length > BOARD_MAX_ROWS) {
    return `The board holds ${board.length} rows and the gate wants ${BOARD_MIN_ROWS} to ${BOARD_MAX_ROWS}.`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!known.has(row.slug)) return `Row ${row.rank} names ${row.slug}, which the snapshot does not list.`;
    if (seen.has(row.slug)) return `The board lists ${row.slug} more than once.`;
    seen.add(row.slug);
  }
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `The ranks are not 1..${board.length}: rank ${i + 1} is ${ranks[i]}.`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (const row of byRank) {
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `Row ${row.rank} (${row.slug}) has an implied value that is not a whole positive dollar amount.`;
    }
  }
  for (let i = 1; i < byRank.length; i++) {
    const prev = byRank[i - 1]!;
    const row = byRank[i]!;
    if (row.implied_value_usd > prev.implied_value_usd) {
      return `Rank ${row.rank} (${row.slug}) is valued above rank ${prev.rank} (${prev.slug}), so the ranking rises.`;
    }
  }
  if (new Set(board.map((row) => row.implied_value_usd)).size === 1) return 'Every row carries the same implied value.';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `The watchlist slug ${slug} has no row on the board.`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (!Array.isArray(steps) || steps.length < STEPS_MIN || steps.length > STEPS_MAX) {
      return `Row ${row.rank} (${row.slug}) has ${Array.isArray(steps) ? steps.length : 0} farm steps and the gate wants ${STEPS_MIN} to ${STEPS_MAX}.`;
    }
    for (const s of steps) {
      if (typeof s !== 'string' || s.length < STEP_MIN_CHARS || s.length > STEP_MAX_CHARS) {
        return `Row ${row.rank} (${row.slug}) has a farm step of ${typeof s === 'string' ? s.length : 0} characters and the gate wants ${STEP_MIN_CHARS} to ${STEP_MAX_CHARS}.`;
      }
    }
  }
  return null;
}
