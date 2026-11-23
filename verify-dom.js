// Real DOM verification for the radar-4 dashboard. Loads out/dashboard/index.html over file://,
// measures the board, the strip, the drawer, the search box and the overflow at two widths.
const path = require('path');
const { chromium } = require('/home/dwizzy/9router-go/web/node_modules/playwright');

const PAGE = 'file://' + path.resolve(__dirname, 'out/dashboard/index.html');

(async () => {
  const browser = await chromium.launch();
  const out = {};
  const errs = [];

  for (const w of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(w + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(w + ' console: ' + m.text()); });
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForSelector('#board-table tbody tr');

    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#board-table tbody tr')];
      const doc = document.documentElement;
      const strip = document.getElementById('calibration');
      const stripText = strip ? strip.textContent : '';
      return {
        rows: rows.length,
        bands: rows.filter(r => r.querySelector('.range-band')).length,
        bandLeftHalf: rows.filter(r => r.querySelectorAll('.c-implied')).length,
        verdictCells: rows.filter(r => r.querySelector('.c-verdict .verdict')).length,
        rangeTxt: rows.filter(r => r.querySelector('.range-txt') && /\$/.test(r.querySelector('.range-txt').textContent)).length,
        bandPctKnown: rows.filter(r => {
          const b = r.querySelector('.range-band');
          return b && b.getAttribute('data-low') && b.getAttribute('data-high');
        }).length,
        stripExists: !!strip,
        stripHasLoo: /median miss 2\.30x, 11 of 24 within 2x/.test(stripText),
        stripHasPeerSlope: /radar-4.*24 peers.*slope −0\.0251/.test(stripText),
        stripHasBoth: /Spearman TVL vs market cap −0\.057/.test(stripText) && /growth vs market cap −0\.099/.test(stripText),
        noteHasMeaning: /fitted to the 24 protocols/.test(stripText) && /not a decoration/.test(stripText),
        stripEmoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(stripText),
        stripBang: /!/.test(stripText),
        overflowX: Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth,
        bodyOverflow: document.body.scrollWidth - window.innerWidth,
        verdictSample: (() => {
          const c = document.querySelector('.c-verdict');
          return c ? c.textContent.trim() : null;
        })()
      };
    });
    out['w' + w] = m;
    await ctx.close();
  }

  // Interaction pass at 1440 only.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('interact: ' + e.message));
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#board-table tbody tr');

  // Band ends must equal low/high relative to the widest row, and the number must not move.
  const bandCheck = await page.evaluate(() => {
    const maxHigh = Math.max(...(window.RADAR.rows.map(r => r.implied_high ?? r.implied_value_usd)));
    const rows = [...document.querySelectorAll('#board-table tbody tr')];
    const bad = [];
    let checked = 0;
    for (const r of rows) {
      const b = r.querySelector('.range-band');
      const low = parseFloat(b.getAttribute('data-low'));
      const high = parseFloat(b.getAttribute('data-high'));
      const sl = parseFloat(b.style.left);
      const sw = parseFloat(b.style.width);
      const wantL = (low / maxHigh) * 100;
      const wantW = Math.max(0.6, ((high / maxHigh) * 100) - wantL);
      checked++;
      if (Math.abs(sl - wantL) > 0.01 || Math.abs(sw - wantW) > 0.01) bad.push({ low, high, sl, sw, wantL, wantW });
    }
    // Does the figure sit exactly above the band (band is behind, positioned absolutely)?
    const r0 = rows[0];
    const fig = r0.querySelector('.c-implied .v');
    const band = r0.querySelector('.range-band');
    const fb = fig.getBoundingClientRect();
    const bb = band.getBoundingClientRect();
    const posOfBand = getComputedStyle(r0.querySelector('.range')).position;
    return { checked, bad: bad.slice(0, 3), bandBehind: posOfBand === 'absolute', bandCoversFigure: bb.left <= fb.right && bb.top <= fb.bottom, figureVisible: fb.width > 0 && fb.height > 0 };
  });

  // Number must not move when the band is toggled off.
  const noMove = await page.evaluate(() => {
    const r0 = document.querySelector('#board-table tbody tr');
    const fig = r0.querySelector('.c-implied .v');
    const before = fig.getBoundingClientRect();
    const band = r0.querySelector('.range');
    band.style.display = 'none';
    const after = fig.getBoundingClientRect();
    band.style.display = '';
    return { dx: Math.abs(before.left - after.left), dy: Math.abs(before.top - after.top) };
  });

  // Drawer: click row 3, expect range + verdict + cost + hours + rate + capital.
  await page.click('#board-table tbody tr:nth-child(3) .proto');
  await page.waitForFunction(() => !document.getElementById('drawer').hidden);
  const drawer = await page.evaluate(() => {
    const d = document.getElementById('d-body');
    const t = d.textContent;
    const steps = d.querySelectorAll('ol.steps li').length;
    const fit = d.querySelector('.d-fit');
    return {
      steps,
      hasFit: !!fit,
      range: /Range.*\$[\d.]+[KMB] – \$[\d.]+[KMB]/.test(t),
      rangeLine: fit ? (fit.querySelector('.range-line') || {}).textContent : null,
      peers: /peer(s)? in this category|pooled fit/.test(t),
      multiple: /Fitted multiple/.test(t) && /×/.test(t),
      verdict: /Verdict/.test(t),
      cost: /Cost/.test(t) && /over [\d.]+ hours/.test(t),
      rate: /\$[\d.]+\/hr/.test(t),
      capital: /Capital/.test(t) && /at work, not spent/.test(t),
      verdictText: fit ? fit.querySelector('.v-marginal .verdict, .v-skip .verdict, .v-worth-it .verdict').textContent : null
    };
  });
  await page.keyboard.press('Escape');

  // Search
  await page.fill('#q', 'steak');
  await page.waitForTimeout(120);
  const search = await page.evaluate(() => ({
    rows: document.querySelectorAll('#board-table tbody tr').length,
    names: [...document.querySelectorAll('#board-table tbody tr .proto .nm, #board-table tbody tr .proto b')].slice(0, 3).map(e => e.textContent.trim()),
    note: document.getElementById('table-note').textContent
  }));
  await page.fill('#q', '');
  await page.waitForTimeout(120);

  // Sorting still works (verdict + implied)
  const sort = await page.evaluate(async () => {
    const sel = document.getElementById('sort');
    const res = {};
    for (const k of ['verdict', 'implied', 'tvl', 'name']) {
      sel.value = k;
      sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 60));
      const rows = [...document.querySelectorAll('#board-table tbody tr')];
      res[k] = { n: rows.length, first: rows[0].querySelector('.proto').textContent.trim().slice(0, 40) };
    }
    sel.value = 'implied';
    sel.dispatchEvent(new Event('change'));
    return res;
  });

  // Category chip filter + live tab still alive
  const tabs = await page.evaluate(async () => {
    const t = document.getElementById('tab-live');
    const r = { tabs: [...document.querySelectorAll('[role=tab], .tab')].length };
    if (t) { t.click(); await new Promise(x => setTimeout(x, 80)); r.liveVisible = !!document.querySelector('#live-table tbody tr, .live tbody tr'); }
    return r;
  });

  await ctx.close();
  await browser.close();

  console.log(JSON.stringify({ out, bandCheck, noMove, drawer, search, sort, tabs, errs }, null, 2));
})().catch(e => { console.error('HARNESS FAIL', e); process.exit(1); });
