/**
 * Token Radar's entry point: it reads the sealed snapshot, ranks the pre-token
 * board with lib/model.ts, and writes the entry's outputs — board.json,
 * data.js, the dashboard, the screenshots, and dossier.json last.
 *
 * Two ways to run it:
 *   in the grader:  node main.ts      (reads /input, writes /output)
 *   outside it:     MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const IMAGE_EXT = /\.(png|jpe?g)$/i;

const here = fileURLToPath(new URL('.', import.meta.url));

/** `--name value` or `--name=value` out of argv, else the fallback. */
function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === flag && argv[i + 1] !== undefined) return argv[i + 1]!;
    if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
  }
  return fallback;
}

function fail(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

/** Copy the regular, non-dotted files of `from` into `to`; returns their names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}. Pass --input <snapshot.json|directory>, or mount the sealed /input.`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboard = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// Only images travel: a stray HTML or script beside them would break the dossier.
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots')).filter((name) => IMAGE_EXT.test(name));
if (shots.length < 3) {
  const count = `${shots.length} image${shots.length === 1 ? '' : 's'}`;
  fail(`screenshots/ holds ${count} and the entry needs three: the board, a detail view and a filtered view.`, 1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`image name "${name}" must be letters, digits and . _ - only, 1 to 128 characters.`, 1);
}

const dossier = buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(out, 'dossier.json'), dossier);

console.log(
  `${snapshot.protocols.length} protocols, ${radar.watchlist_size} on the watchlist, ${radar.board_size} on the board ` +
    `(${radar.early_size} early, ${radar.live_size} live protocols set aside).`,
);
// The model card, in the console: what the multiples were fitted on and how well they predict it.
const cal = radar.calibration;
console.log(
  `${cal.model_version}: ${cal.n_peers} peers, slope ${cal.slope.toFixed(4)}, spearman tvl/mcap ${cal.spearman_tvl_mcap.toFixed(3)} ` +
    `(growth/mcap ${cal.spearman_growth_mcap.toFixed(3)}); pooled multiple ${cal.pooled_multiple.toFixed(3)}; ` +
    `leave-one-out n=${cal.loo.n}, median ratio ${cal.loo.median_ratio.toFixed(2)}x, within2x ${cal.loo.within2x}/${cal.loo.n}.`,
);
console.log(
  `wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}/ (${dashboard.length} files), ` +
    `${join(out, 'screenshots')}/ (${shots.length} images), ${join(out, 'dossier.json')}.`,
);
