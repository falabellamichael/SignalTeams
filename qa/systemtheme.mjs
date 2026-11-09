export default async function (page, ctx) {
  for (const t of await page.$$('button')) {
    if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  await inputs[0].type('mike'); await inputs[1].type('password');
  for (const b of await page.$$('button')) {
    const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase();
    if (t.includes('sign') || t.includes('log') || t.includes('continue')) { await b.click(); break; }
  }
  await page.waitForSelector('.rail', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  // open settings via me-bar gear
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x =>
      (x.getAttribute('title') || '').toLowerCase().includes('settings') ||
      (x.getAttribute('aria-label') || '').toLowerCase().includes('settings'));
    b?.click();
  });
  await new Promise(r => setTimeout(r, 1200));
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  // click Match OS
  const hit = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Match OS'));
    b?.click(); return !!b;
  });
  await new Promise(r => setTimeout(r, 600));
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem('signalteams.theme'),
    on: [...document.querySelectorAll('button.on')].map(e => e.textContent.trim()).filter(t => t.includes('Match')),
  }));
  console.log(JSON.stringify({ before, hit, after }, null, 2));
}
