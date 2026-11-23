/* ==========================================================================
   PRE-TOKEN RADAR — app.js
   Plain ES2020, no framework, no fetch. Reads window.RADAR from ../data.js.

   1. Boot and state
   2. Formatting helpers
   3. DOM helper
   4. Masthead
   5. Model card
   6. Validation panel
   7. Calibration canvas
   8. Board: rows, sort, filter
   9. Drawer
  10. Watchlist
   ========================================================================== */
'use strict';

/* 1. BOOT AND STATE -------------------------------------------------------- */

const R = window.RADAR || null;

/** Filter and sort state. Rows are built once; everything else mutates this. */
const state = {
  q: '',
  conf: '',
  cat: '',
  key: 'rank',
  dir: 'asc',
  active: null,
};

/** Board row -> its <tr>, filled once during build. */
const rowEls = new Map();

/* 2. FORMATTING HELPERS ---------------------------------------------------- */

/** $ with a M/B suffix at one decimal; K below a million, dollars below a thousand. */
function formatUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Signed percentage with two decimals, plus or minus spelled out. */
function formatPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

/** Days as a compact human age; long spans fall back to years. */
function ageLabel(days) {
  const d = Math.round(Number(days));
  if (!Number.isFinite(d)) return '—';
  if (d < 60) return `${d}d`;
  if (d < 730) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

/** One band cell: low to high, both compact. */
function bandLabel(low, high) {
  return `${formatUsd(low)}–${formatUsd(high)}`;
}

/** The fit-range chip. Not a probability: it says whether TVL sits in the fitted range. */
function confidenceChip(level) {
  const key = String(level || '').toLowerCase();
  const word = key === 'high' ? 'in range' : key === 'medium' ? 'edge' : 'extrapolated';
  const span = document.createElement('span');
  span.className = `chip ${key || 'low'}`;
  span.textContent = word;
  span.title =
    key === 'high'
      ? 'High: TVL between the 25th and 75th percentile of the 128 training rows ($10.4M to $98.2M).'
      : key === 'medium'
        ? 'Medium: TVL inside the 10th to 90th percentile ($7.3M to $1.10B), outside the interquartile box.'
        : 'Low: TVL outside the 10th to 90th percentile of the training rows, so the model extrapolates.';
  return span;
}

/** Multiplier with two decimals and a trailing x. */
function multipleLabel(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(2)}x` : '—';
}

/** Fixed-decimal number, em dash when not finite. */
function num(n, digits) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : '—';
}

/* 3. DOM HELPER ------------------------------------------------------------ */

/** el('div', 'cls', text) or el('td', {class, title, dataset}, children). */
function el(tag, clsOrAttrs, content) {
  const node = document.createElement(tag);
  if (typeof clsOrAttrs === 'string') {
    node.className = clsOrAttrs;
  } else if (clsOrAttrs) {
    if (clsOrAttrs.class) node.className = clsOrAttrs.class;
    if (clsOrAttrs.title) node.title = clsOrAttrs.title;
    if (clsOrAttrs.text != null) node.textContent = clsOrAttrs.text;
    if (clsOrAttrs.dataset) Object.assign(node.dataset, clsOrAttrs.dataset);
    if (clsOrAttrs.attrs) for (const k in clsOrAttrs.attrs) node.setAttribute(k, clsOrAttrs.attrs[k]);
  }
  if (content != null) {
    if (Array.isArray(content)) {
      for (const c of content) if (c) node.append(c);
    } else {
      node.textContent = String(content);
    }
  }
  return node;
}

/** Definition-list cell: <div><dt>label</dt><dd>value</dd></div>. */
function fact(label, value, accent) {
  const dd = el('dd', accent ? 'is-accent' : null, value);
  return el('div', null, [el('dt', null, label), dd]);
}

/* 4. MASTHEAD -------------------------------------------------------------- */

const DATE_FMT = { year: 'numeric', month: 'short', day: '2-digit' };

/** "2026-11-14" -> "14 Nov 2026", parsed as UTC so no timezone shifts it. */
function stampDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { ...DATE_FMT, timeZone: 'UTC' });
}

/** Runs of the source string, with any protocol dropped so the page names no address. */
function cleanSource(source) {
  return String(source)
    .replace(/\s*,?\s*\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;]\s*$/, '')
    .trim();
}

/** Numbers the masthead needs: median band ratio and the walk-forward figure. */
function mastheadFigures() {
  const ratios = R.board.map((row) => row.band_ratio).filter(Number.isFinite).sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  const chosen = R.model.comparison.find((m) => m.name === R.model.chosen);
  return { medianBand: median, walk: chosen ? chosen.walk_forward_spearman : null };
}

function renderMasthead() {
  const { meta, model } = R;
  const { medianBand, walk } = mastheadFigures();
  const stamp = document.getElementById('stamp');
  stamp.textContent = [
    `as of ${stampDate(meta.as_of)}`,
    `source ${cleanSource(meta.source)}`,
    `${meta.protocol_count} protocols`,
    `${meta.training_rows} training rows`,
    `${meta.candidate_count} candidates`,
    `floor ${formatUsd(meta.floor_usd)}`,
    `model ${model.name}`,
  ].join(' · ');

  const strip = document.getElementById('statstrip');
  strip.append(
    fact('Candidates', String(meta.candidate_count)),
    fact('Median band ratio', `${medianBand.toFixed(1)}x`),
    fact('Walk-forward rank corr.', walk == null ? '—' : walk.toFixed(3), true),
  );
}

/* 5. MODEL CARD ------------------------------------------------------------ */

/** The equation with real coefficients, printed on four aligned lines. */
function equationBlock() {
  const m = R.model;
  return [
    `log_mcap = ${num(m.INTERCEPT, 3)}`,
    `         + ${num(m.TVL_EXP, 3)} * log(tvl_usd)`,
    `         - ${num(Math.abs(m.AGE_EXP), 3)} * log1p(age_days)`,
    `         - ${num(Math.abs(m.CHG_EXP), 3)} * change_7d`,
  ].join('\n');
}

function renderModelCard() {
  const m = R.model;
  const bandFactor = Math.exp(m.BAND_Z * m.RESID_SD);
  document.getElementById('equation').textContent = equationBlock();

  document.getElementById('model-facts').append(
    fact('Intercept', num(m.INTERCEPT, 3)),
    fact('TVL exponent', num(m.TVL_EXP, 3)),
    fact('Age exponent', num(m.AGE_EXP, 3)),
    fact('Change exponent', num(m.CHG_EXP, 3)),
    fact('Residual SD', `${num(m.RESID_SD, 3)} log pts`),
    fact('80% band factor', `${bandFactor.toFixed(2)}x`, true),
  );

  document.getElementById('model-note').textContent =
    `Read it as a queue, not a price target. The fit prices a pre-token protocol from three things only — ` +
    `its TVL, how long it has run tokenless, and its seven-day change — so every miss of ` +
    `${num(m.RESID_SD, 2)} log points widens the 80% band by e^(${num(m.BAND_Z, 4)} × ${num(m.RESID_SD, 3)}) = ` +
    `${bandFactor.toFixed(2)}x either side. A ${bandFactor.toFixed(0)}x-wide band cannot call a listing price; ` +
    `it orders the research queue, and this page says so everywhere the figure appears.`;
}

/** The screened-out strip: why 293 rows are ranked out of 758 protocols. */
function renderScreened() {
  const { meta } = R;
  const s = meta.screened || {};
  const box = document.getElementById('screened');
  const kept = meta.protocol_count - (meta.screened_total || 0);
  box.append(
    fact('Holds a ticker', String(s.symbol ?? 0)),
    fact('Has a CoinGecko id', String(s.gecko_id ?? 0)),
    fact('Centralised exchange', String(s.cex ?? 0)),
    fact('Above fitted TVL range', String(s.above_range ?? 0)),
    fact('Ranked on the board', String(meta.candidate_count)),
    fact(`Screened out of ${meta.protocol_count}`, String(meta.screened_total ?? 0)),
  );
  const total = box.lastChild;
  total.className = 'total';
  total.title = `${meta.protocol_count} protocols minus ${meta.screened_total} screened = ${kept} ranked`;
}

/* 6. VALIDATION PANEL ------------------------------------------------------ */

function renderValidation() {
  const m = R.model;
  const body = document.getElementById('compare-body');
  for (const row of m.comparison) {
    const chosen = row.name === m.chosen;
    const nameCell = el('td', null, [el('span', null, row.name)]);
    if (chosen) nameCell.append(el('span', 'tag', 'chosen'));
    const tr = el('tr', chosen ? 'chosen' : null, [
      nameCell,
      el('td', 'feat', row.features.join(', ')),
      el('td', 'num', num(row.loo_spearman, 3)),
      el('td', 'num', num(row.walk_forward_spearman, 3)),
      el('td', 'num', num(row.residual_sd, 3)),
    ]);
    body.append(tr);
  }

  const total = R.meta.training_rows;
  const fit = Math.floor(total * 0.7);
  document.getElementById('split-note').textContent =
    `The walk-forward column was fitted on the oldest 70% of the ${total} rows by listing date ` +
    `(${fit} rows) and scored on the newest ${total - fit}. Leave-one-out refits ${total} times, ` +
    `each time blind to one row.`;
  document.getElementById('reason-note').textContent = m.reason || '';
}

/* 7. CALIBRATION CANVAS ---------------------------------------------------- */

const CAL_PAD = { top: 16, right: 18, bottom: 34, left: 62 };
const CAL_FONT = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const CAL_INK = { faint: '#7d8792', dim: '#9aa3ad', rule: '#1e242b', edge: '#2a333d' };

/** Decade ticks covering [lo, hi]. */
function decadeTicks(lo, hi) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const v = 10 ** e;
    if (v >= lo * 0.5 && v <= hi * 2) ticks.push(v);
  }
  return ticks;
}

/** Log-log x mapping for one value inside the plotted domain. */
function xOf(v, box, lo, hi) {
  const span = Math.log10(hi) - Math.log10(lo);
  return box.x + ((Math.log10(v) - Math.log10(lo)) / span) * box.w;
}

/** Vertical decade grid, ticks and labels. */
function drawXAxis(ctx, box, lo, hi) {
  ctx.textAlign = 'center';
  for (const t of decadeTicks(lo, hi)) {
    const px = Math.round(xOf(t, box, lo, hi)) + 0.5;
    ctx.strokeStyle = CAL_INK.rule;
    ctx.beginPath();
    ctx.moveTo(px, box.y);
    ctx.lineTo(px, box.y + box.h);
    ctx.stroke();
    ctx.fillStyle = CAL_INK.faint;
    ctx.fillText(formatUsd(t), px, box.y + box.h + 14);
  }
}

/** Horizontal decade grid, ticks and labels. */
function drawYAxis(ctx, box, lo, hi) {
  ctx.textAlign = 'right';
  for (const t of decadeTicks(lo, hi)) {
    const py = Math.round(yOf(t, box, lo, hi)) + 0.5;
    ctx.strokeStyle = CAL_INK.rule;
    ctx.beginPath();
    ctx.moveTo(box.x, py);
    ctx.lineTo(box.x + box.w, py);
    ctx.stroke();
    ctx.fillStyle = CAL_INK.faint;
    ctx.fillText(formatUsd(t), box.x - 8, py);
  }
}

/** The two axis titles, the y one rotated into the left margin. */
function drawAxisTitles(ctx, box) {
  ctx.fillStyle = CAL_INK.dim;
  ctx.textAlign = 'left';
  ctx.fillText('implied value, log (x)', box.x, box.H - 8);
  ctx.save();
  ctx.translate(12, box.y + box.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('actual market cap, log (y)', 0, 0);
  ctx.restore();
}

/** Background, grid and frame; returns the x and y scales the marks share. */
function drawFrame(ctx, box, lo, hi) {
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, box.W, box.H);
  ctx.font = CAL_FONT;
  ctx.textBaseline = 'middle';
  drawXAxis(ctx, box, lo, hi);
  drawYAxis(ctx, box, lo, hi);
  ctx.strokeStyle = CAL_INK.edge;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  drawAxisTitles(ctx, box);
  return { x: (v) => xOf(v, box, lo, hi), y: (v) => yOf(v, box, lo, hi) };
}

/** Log-log y mapping for one value inside the plotted decades. */
function yOf(v, box, lo, hi) {
  const span = Math.log10(hi) - Math.log10(lo);
  return box.y + box.h - ((Math.log10(v) - Math.log10(lo)) / span) * box.h;
}

/** Fills the band between its two edges, for the case where no dots can be drawn. */
function drawCone(ctx, s, lo, hi) {
  const band = Math.exp(R.model.BAND_Z * R.model.RESID_SD);
  ctx.beginPath();
  ctx.moveTo(s.x(lo), s.y(lo * band));
  ctx.lineTo(s.x(hi), s.y(hi * band));
  ctx.lineTo(s.x(hi), s.y(hi / band));
  ctx.lineTo(s.x(lo), s.y(lo / band));
  ctx.closePath();
  ctx.fillStyle = 'rgba(245, 181, 68, 0.08)';
  ctx.fill();
}

/** Straight log-space lines: the 1:1 identity and the two band edges. */
function drawLines(ctx, s, box, lo, hi, hasPoints) {
  const band = Math.exp(R.model.BAND_Z * R.model.RESID_SD);
  if (!hasPoints) drawCone(ctx, s, lo, hi);
  const lines = [
    { k: band, color: '#f5b544', dash: [4, 4], label: `+80% edge, ×${band.toFixed(1)}` },
    { k: 1, color: '#dfe4ea', dash: [], label: '1:1' },
    { k: 1 / band, color: '#f5b544', dash: [4, 4], label: '' },
  ];
  for (const line of lines) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.k === 1 ? 1.2 : 1;
    ctx.setLineDash(line.dash);
    ctx.beginPath();
    ctx.moveTo(s.x(lo), s.y(lo * line.k));
    ctx.lineTo(s.x(hi), s.y(hi * line.k));
    ctx.stroke();
    ctx.setLineDash([]);
    if (!line.label) continue;
    const lx = box.x + box.w - 6;
    const ly = s.y(hi * line.k);
    if (ly > box.y + 10 && ly < box.y + box.h - 4) {
      ctx.fillStyle = line.color;
      ctx.textAlign = 'right';
      ctx.fillText(line.label, lx, ly - 7);
    }
  }
  ctx.lineWidth = 1;
}

/** Training points, then the fitted cone for whatever the axes cover. */
function drawPoints(ctx, s, rows) {
  ctx.fillStyle = 'rgba(110, 231, 168, 0.55)';
  for (const p of rows) {
    const px = s.x(p.implied_usd);
    const py = s.y(p.actual_usd);
    ctx.beginPath();
    ctx.arc(px, py, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Resolves the training array; the band cone is the fallback, honestly labelled. */
function trainingRows() {
  const t = R.model && Array.isArray(R.model.training) ? R.model.training : null;
  const usable = t ? t.filter((r) => r && r.implied_usd > 0 && r.actual_usd > 0) : [];
  return usable;
}

/** The shared log domain: a little air around every value the plot must show. */
function domainOf(rows) {
  if (!rows.length) return { lo: 1e6, hi: 1e11 };
  const all = rows.flatMap((r) => [r.implied_usd, r.actual_usd]);
  const lo = Math.min(...all) / 1.6;
  const hi = Math.max(...all) * 1.6;
  return { lo, hi: hi > lo * 10 ? hi : lo * 10 };
}

function renderCalibration() {
  const canvas = document.getElementById('cal-canvas');
  const ctx = canvas.getContext('2d');
  const rows = trainingRows();

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 640;
    const cssH = canvas.clientHeight || 320;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const box = {
      x: CAL_PAD.left,
      y: CAL_PAD.top,
      w: Math.max(80, W - CAL_PAD.left - CAL_PAD.right),
      h: Math.max(80, cssH - CAL_PAD.top - CAL_PAD.bottom),
      W,
      H: cssH,
    };
    const { lo, hi } = domainOf(rows);
    const s = drawFrame(ctx, box, lo, hi);
    drawLines(ctx, s, box, lo, hi, rows.length > 0);
    drawPoints(ctx, s, rows);
    stampCalibration(rows, box);
  };

  draw();
  window.addEventListener('resize', () => {
    window.clearTimeout(draw.timer);
    draw.timer = window.setTimeout(draw, 120);
  });
}

/** Side column and canvas label: point count, and whether this is the real scatter. */
function stampCalibration(rows, box) {
  const m = R.model;
  const band = Math.exp(m.BAND_Z * m.RESID_SD);
  const facts = document.getElementById('cal-facts');
  if (!facts.childElementCount) {
    const loo = R.calibration && R.calibration.loo;
    facts.append(
      fact('Training points', String(rows.length)),
      fact('Band width', `${band.toFixed(2)}x`, true),
      fact('Residual SD', num(m.RESID_SD, 3)),
      loo ? fact('Within 2x', `${loo.within2x} / ${loo.n}`) : fact('Rank (LOO)', num(R.calibration?.slope, 3)),
    );
  }
  const note = document.getElementById('cal-note');
  note.textContent = rows.length
    ? `Each dot is one of the ${rows.length} protocols the fit used, at its implied value against its actual market cap. ` +
      `The white line is 1:1; the amber lines are the 80% band, ×${band.toFixed(2)} and ÷${band.toFixed(2)}. ` +
      `Dots at the top left are protocols the equation undervalues, which is why the queue is a research list.`
    : `The radar object carries no training rows here, so no scatter is drawn. The amber cone is the fitted band only: ` +
      `the region between ×${band.toFixed(2)} and ÷${band.toFixed(2)} of the equation, labelled as such.`;
  if (!rows.length) {
    const ctx = document.getElementById('cal-canvas').getContext('2d');
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#f5b544';
    ctx.textAlign = 'left';
    ctx.fillText('fitted band only — no training rows in this payload', box.x + 8, box.y + 2);
  }
}

/* 8. BOARD: ROWS, SORT, FILTER --------------------------------------------- */

/** Does this row survive the query and the two selects. */
function matches(row, q, conf, cat) {
  if (conf && row.confidence !== conf) return false;
  if (cat && row.category !== cat) return false;
  if (!q) return true;
  const hay = `${row.name} ${row.category} ${(row.chains || []).join(' ')}`.toLowerCase();
  return hay.includes(q);
}

/** The numeric value a sort key compares on. */
function sortValue(row, key) {
  switch (key) {
    case 'implied': return row.implied_value_usd;
    case 'tvl': return row.tvl_usd;
    case 'age': return row.age_days;
    case 'band': return row.band_ratio;
    case 'multiple': return row.multiple;
    case 'name': return row.name.toLowerCase();
    case 'category': return row.category.toLowerCase();
    case 'confidence': return { high: 3, medium: 2, low: 1 }[row.confidence] || 0;
    default: return row.rank;
  }
}

/** One <tr> for one board row. Everything set here, nothing re-rendered later. */
function buildRow(row) {
  const tr = el('tr', { dataset: { slug: row.slug } });
  tr.tabIndex = 0;
  tr.append(
    el('td', 'num c-rank', String(row.rank)),
    el('td', { class: 'c-name', text: row.name, title: row.name }),
    el('td', { class: 'c-cat', text: row.category, title: row.category }),
    el('td', 'num c-tvl', formatUsd(row.tvl_usd)),
    el('td', 'num c-age', ageLabel(row.age_days)),
    el('td', 'num c-implied', formatUsd(row.implied_value_usd)),
    el('td', 'num c-band', bandLabel(row.low_usd, row.high_usd)),
    el('td', 'num c-mult', multipleLabel(row.multiple)),
    el('td', 'c-fit'),
  );
  tr.querySelector('.c-fit').append(confidenceChip(row.confidence));
  tr.addEventListener('click', () => openDrawer(row));
  tr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDrawer(row);
    }
  });
  return tr;
}

function buildBoard() {
  const frag = document.createDocumentFragment();
  for (const row of R.board) {
    const tr = buildRow(row);
    rowEls.set(row.slug, tr);
    frag.append(tr);
  }
  document.getElementById('board-body').append(frag);
}

/** Reorders the existing nodes. No rebuild, no new elements. */
function applySort(key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...R.board].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x < y) return -sign;
    if (x > y) return sign;
    return a.rank - b.rank;
  });
  const body = document.getElementById('board-body');
  for (const row of sorted) body.append(rowEls.get(row.slug));
}

/** Mark the visible rows; hidden rows stay in the DOM for sorting. */
function applyFilter() {
  const q = state.q.trim().toLowerCase();
  let visible = 0;
  for (const row of R.board) {
    const show = matches(row, q, state.conf, state.cat);
    const tr = rowEls.get(row.slug);
    tr.classList.toggle('is-hidden', !show);
    if (show) visible++;
  }
  const count = document.getElementById('count');
  count.replaceChildren(
    el('b', null, String(visible)),
    document.createTextNode(` of ${R.board.length} candidates`),
  );
}

/** Debounce wrapper: 120 ms, matching the filter contract. */
function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function wireBoardControls() {
  const q = document.getElementById('q');
  q.addEventListener('input', debounce(() => {
    state.q = q.value;
    applyFilter();
  }, 120));

  const conf = document.getElementById('f-conf');
  for (const level of ['high', 'medium', 'low']) {
    conf.append(el('option', { attrs: { value: level } }, level));
  }
  conf.addEventListener('change', () => {
    state.conf = conf.value;
    applyFilter();
  });

  const cat = document.getElementById('f-cat');
  const cats = [...new Set(R.board.map((r) => r.category))].sort((a, b) => a.localeCompare(b));
  for (const name of cats) cat.append(el('option', { attrs: { value: name } }, name));
  cat.addEventListener('change', () => {
    state.cat = cat.value;
    applyFilter();
  });

  for (const btn of document.querySelectorAll('.board th .sort')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      const ascFirst = key === 'rank' || key === 'name' || key === 'category' || key === 'age';
      const dir = state.key === key ? (state.dir === 'asc' ? 'desc' : 'asc') : ascFirst ? 'asc' : 'desc';
      state.key = key;
      state.dir = dir;
      for (const th of document.querySelectorAll('.board thead th')) th.removeAttribute('aria-sort');
      btn.closest('th').setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      applySort(key, dir);
    });
  }
}

/* 9. DRAWER ---------------------------------------------------------------- */

const drawer = document.getElementById('drawer');
let lastFocus = null;

/** Builds the figures, band, thesis and steps for one row. */
function drawerContent(row) {
  const figs = el('dl', 'd-figs', [
    el('div', null, [el('dt', null, 'TVL'), el('dd', null, formatUsd(row.tvl_usd))]),
    el('div', null, [el('dt', null, 'Implied value'), el('dd', 'is-accent', formatUsd(row.implied_value_usd))]),
    el('div', null, [el('dt', null, 'Multiple'), el('dd', null, multipleLabel(row.multiple))]),
  ]);

  const band = el('div', 'd-band', [
    el('span', null, formatUsd(row.low_usd)),
    el('span', 'arrow', '→'),
    el('span', null, formatUsd(row.high_usd)),
    el('span', 'ratio', `band ratio ${num(row.band_ratio, 2)}x`),
  ]);

  const thesis = el('section', 'd-sec', [
    el('p', 'lbl', 'Thesis'),
    el('p', null, row.thesis),
  ]);

  const steps = el('ol', 'steps');
  for (const step of row.farm_steps || []) steps.append(el('li', null, step));
  const plan = el('section', 'd-sec', [el('p', 'lbl', `Farm plan · ${(row.farm_steps || []).length} steps`), steps]);

  const move = el('section', 'd-sec', [
    el('p', 'lbl', 'Seven-day move'),
    el('p', null, `${formatPct(row.change_7d)} in TVL over seven days, ${row.age_days} days tokenless.`),
  ]);

  return el('div', null, [figs, el('section', 'd-sec', [el('p', 'lbl', '80% band'), band]), thesis, move, plan]);
}

function openDrawer(row) {
  if (!lastFocus) lastFocus = document.activeElement;
  document.getElementById('d-kicker').textContent = `Rank ${row.rank} · ${row.confidence} fit range`;
  document.getElementById('d-name').textContent = row.name;
  document.getElementById('d-sub').textContent = `${row.category} · ${(row.chains || []).join(', ') || 'no chain listed'}`;
  const body = document.getElementById('d-body');
  body.replaceChildren(drawerContent(row));
  body.scrollTop = 0;
  drawer.hidden = false;

  if (state.active) rowEls.get(state.active)?.classList.remove('is-active');
  state.active = row.slug;
  rowEls.get(row.slug)?.classList.add('is-active');
  document.getElementById('d-close').focus();
}

function closeDrawer() {
  if (drawer.hidden) return;
  drawer.hidden = true;
  if (state.active) rowEls.get(state.active)?.classList.remove('is-active');
  state.active = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

function wireDrawer() {
  document.getElementById('d-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
}

/* 10. WATCHLIST ------------------------------------------------------------ */

function renderWatchlist() {
  const list = R.watchlist || [];
  const body = document.getElementById('watch-body');
  for (const row of list) {
    body.append(
      el('li', null, [
        el('span', 'w-rank', String(row.rank)),
        el('span', 'w-name', { title: `${row.name} — ${row.category}`, text: row.name }),
        el('span', 'w-val', formatUsd(row.implied_value_usd)),
      ]),
    );
  }
  const named = list[0] ? ` Top of it: ${list[0].name} at ${formatUsd(list[0].implied_value_usd)}.` : '';
  document.getElementById('watch-note').textContent =
    `The ${list.length} protocols the brief names, in rank order, with the value the equation implies for each.${named}`;
}

/* 11. MOUNT ---------------------------------------------------------------- */

function boot() {
  if (!R) {
    document.getElementById('stamp').textContent = 'data.js did not load, so no figures are shown.';
    return;
  }
  renderMasthead();
  renderModelCard();
  renderScreened();
  renderValidation();
  renderCalibration();
  buildBoard();
  applySort(state.key, state.dir);
  wireBoardControls();
  applyFilter();
  wireDrawer();
  renderWatchlist();
}

boot();
