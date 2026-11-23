// Captures the three entry screenshots from the built dashboard:
// the board, a detail drawer and a filtered view. 1440x900, PNG, under 512 KB.
const path = require('path');
const { chromium } = require('/home/dwizzy/9router-go/web/node_modules/playwright');

const PAGE = 'file://' + path.resolve(__dirname, 'out/dashboard/index.html');
const OUT = path.resolve(__dirname, 'screenshots');

/** Puts the board panel's top edge 10px under the viewport top. */
async function frameBoard(page) {
  await page.evaluate(() => {
    const top = document.getElementById('board').getBoundingClientRect().top + window.scrollY - 10;
    window.scrollTo(0, top);
  });
  await page.waitForTimeout(180);
  return page.evaluate(() => window.scrollY);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.waitForSelector('#board-table tbody tr');

  const y1 = await frameBoard(page);
  await page.screenshot({ path: path.join(OUT, 'board.png') });

  await page.click('#board-table tbody tr:nth-child(1)');
  await page.waitForFunction(() => !document.getElementById('drawer').hidden);
  await page.waitForTimeout(180);
  const y2 = await frameBoard(page);
  await page.screenshot({ path: path.join(OUT, 'detail.png') });
  await page.keyboard.press('Escape');

  const y3 = await frameBoard(page);
  await page.evaluate(() => {
    const cat = document.getElementById('f-cat');
    cat.value = 'Lending';
    cat.dispatchEvent(new Event('change'));
    const conf = document.getElementById('f-conf');
    conf.value = 'high';
    conf.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(OUT, 'filtered.png') });

  await browser.close();
  console.log(JSON.stringify({ y1, y2, y3, wrote: ['board.png', 'detail.png', 'filtered.png'] }));
})().catch((e) => { console.error(e); process.exit(1); });
