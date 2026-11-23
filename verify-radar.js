// Verification harness for the rebuilt Pre-Token Radar dashboard.
// Loads out/dashboard/index.html over file://, checks layout, overflow, sorting,
// filtering, the drawer and the calibration canvas at 1440x900 and 390x844.
const path = require('path');
const { chromium } = require('/home/dwizzy/9router-go/web/node_modules/playwright');

const PAGE = 'file://' + path.resolve(__dirname, 'out/dashboard/index.html');

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const errs = [];
  const out = {};

  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`${w}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`${w} console: ${m.text()}`); });
    page.on('request', (r) => { if (!r.url().startsWith('file:')) errs.push(`${w} NETWORK: ${r.url()}`); });
    await page.goto(PAGE, { waitUntil: 'load' });
    await page.waitForSelector('#board-table tbody tr');

    out['w' + w] = await page.evaluate(() => {
      const doc = document.documentElement;
      const rows = [...document.querySelectorAll('#board-table tbody tr')];
      const cs = getComputedStyle(document.body);
      const canvas = document.getElementById('cal-canvas');
      const cctx = canvas.getContext('2d');
      const px = cctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
      const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > doc.clientWidth + 1);
      return {
        rows: rows.length,
        hidden: rows.filter((r) => r.classList.contains('is-hidden')).length,
        count: document.getElementById('count').textContent.trim(),
        overflow: Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth,
        widest: wide.slice(0, 3).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)),
        bodyBg: cs.backgroundColor,
        fontFamily: cs.fontFamily,
        canvasLit: lit,
        canvasBox: [canvas.clientWidth, canvas.clientHeight],
        equation: document.getElementById('equation').textContent.split('\n')[0],
        bandFact: [...document.querySelectorAll('#model-facts div')].map((d) => d.textContent).join(' | '),
        screened: document.getElementById('screened').textContent,
        stamp: document.getElementById('stamp').textContent,
        stats: document.getElementById('statstrip').textContent,
        chips: [...new Set(rows.map((r) => r.querySelector('.chip').className))],
        firstRow: rows[0].textContent.trim().slice(0, 80),
        headSticky: getComputedStyle(document.querySelector('.board thead th')).position,
        watch: document.querySelectorAll('#watch-body li').length,
        ariaSort: document.querySelector('.board th[aria-sort]')?.getAttribute('aria-sort'),
        emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText),
      };
    });
    await page.screenshot({ path: `/tmp/radar-check-${w}.png`, fullPage: false });
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('interact: ' + e.message));
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#board-table tbody tr');

  const sort = await page.evaluate(async () => {
    const click = (k) => document.querySelector(`.sort[data-key="${k}"]`).click();
    const first = () => document.querySelector('#board-table tbody tr:not(.is-hidden)').textContent.trim().slice(0, 40);
    const res = {};
    for (const k of ['implied', 'tvl', 'age', 'multiple', 'band']) {
      click(k);
      await new Promise((r) => setTimeout(r, 40));
      res[k] = first();
    }
    click('rank');
    await new Promise((r) => setTimeout(r, 40));
    res.rank = first();
    return res;
  });

  const filter = await page.evaluate(async () => {
    const q = document.getElementById('q');
    q.value = 'steak';
    q.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));
    const a = document.getElementById('count').textContent.trim();
    const n = document.querySelectorAll('#board-table tbody tr:not(.is-hidden)').length;
    q.value = '';
    q.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));
    const conf = document.getElementById('f-conf');
    conf.value = 'low';
    conf.dispatchEvent(new Event('change'));
    const lowN = document.querySelectorAll('#board-table tbody tr:not(.is-hidden)').length;
    const lowChips = [...new Set([...document.querySelectorAll('#board-table tbody tr:not(.is-hidden) .chip')].map((c) => c.className))];
    conf.value = '';
    conf.dispatchEvent(new Event('change'));
    const cat = document.getElementById('f-cat');
    cat.value = 'RWA';
    cat.dispatchEvent(new Event('change'));
    const catN = document.querySelectorAll('#board-table tbody tr:not(.is-hidden)').length;
    cat.value = '';
    cat.dispatchEvent(new Event('change'));
    return { searchCount: a, searchRows: n, lowN, lowChips, catN, after: document.getElementById('count').textContent.trim() };
  });

  await page.click('#board-table tbody tr:nth-child(1)');
  await page.waitForFunction(() => !document.getElementById('drawer').hidden);
  const drawer = await page.evaluate(() => {
    const d = document.getElementById('d-body');
    const close = document.getElementById('d-close');
    return {
      name: document.getElementById('d-name').textContent,
      sub: document.getElementById('d-sub').textContent,
      figs: d.querySelectorAll('.d-figs dd').length,
      band: d.querySelector('.d-band')?.textContent.trim(),
      steps: d.querySelectorAll('.steps li').length,
      hasThesis: d.textContent.includes('Thesis'),
      scrollable: d.scrollHeight > d.clientHeight,
      closeFocus: document.activeElement === close,
      outline: getComputedStyle(close).outlineColor,
    };
  });
  await page.screenshot({ path: '/tmp/radar-check-drawer.png' });
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.getElementById('drawer').hidden);

  await ctx.close();
  await browser.close();
  console.log(JSON.stringify({ out, sort, filter, drawer, closed, errs }, null, 2));
})().catch((e) => { console.error('HARNESS FAIL', e); process.exit(1); });
