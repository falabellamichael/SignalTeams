// verify stale-chunk self-heal: block the settings chunk → click settings →
// expect auto-reload (lazyRetry), not a blank app. Second blocked failure → CrashGuard.
export default async function (page, ctx) {
  const report = { steps: [] };
  const log = (s) => { report.steps.push(s); console.log('  ' + s); };

  await page.goto('http://127.0.0.1:8075', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input, .rail', { timeout: 15000 });
  for (const t of await page.$$('button')) {
    if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].type('mike'); await inputs[1].type('password');
    for (const b of await page.$$('button')) {
      const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase();
      if (t.includes('sign') || t.includes('log') || t.includes('continue')) { await b.click(); break; }
    }
  }
  await page.waitForSelector('.rail', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  log('logged in');

  const bodyLen = () => page.evaluate(() => document.body.innerHTML.length);
  const crashShown = () => page.$$eval('.crashguard', els => els.length).catch(() => -1);

  // ---- TEST 1: block the settings chunk → click settings → should reload ----
  await page.route('**/assets/settings-*.js', (r) => r.abort());
  let navigated = false;
  page.once('framenavigated', () => { navigated = true; });
  await page.evaluate(() => document.querySelector('.me-btn[title="Settings"]')?.click());
  await new Promise(r => setTimeout(r, 4000));
  report.test1 = { reloaded: navigated, crash: await crashShown(), bodyLen: await bodyLen() };
  log('blocked-chunk click → ' + JSON.stringify(report.test1));

  // after the reload the route is still attached → unblock, wait for app, retry settings
  await page.unroute('**/assets/settings-*.js');
  await page.waitForSelector('.rail, input', { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2500));
  // still logged in (token persisted)
  await page.evaluate(() => document.querySelector('.me-btn[title="Settings"]')?.click());
  await new Promise(r => setTimeout(r, 2500));
  report.test2 = {
    modalOpen: await page.$$eval('.modal, [class*="modal"]', els => els.length).catch(() => -1),
    crash: await crashShown(),
  };
  log('post-reload settings → ' + JSON.stringify(report.test2));

  // ---- TEST 3: block AGAIN and click → flag was cleared by the good import →
  // reload happens again; keep it blocked → click once more → CrashGuard ----
  await page.keyboard.press('Escape');
  await page.route('**/assets/settings-*.js', (r) => r.abort());
  navigated = false;
  page.once('framenavigated', () => { navigated = true; });
  await page.evaluate(() => document.querySelector('.me-btn[title="Settings"]')?.click());
  await new Promise(r => setTimeout(r, 4000));
  await page.waitForSelector('.rail, input', { timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.querySelector('.me-btn[title="Settings"]')?.click());
  await new Promise(r => setTimeout(r, 3000));
  report.test3 = {
    reloaded: navigated,
    crash: await crashShown(),
    bodyLen: await bodyLen(),
  };
  log('double-blocked → ' + JSON.stringify(report.test3));

  await page.screenshot({ path: 'qa/shots/stalechunk.png' });
  console.log(JSON.stringify(report, null, 2));
}
