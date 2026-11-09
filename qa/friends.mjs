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
  // open Friends view
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('Friends'));
    it?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  const rows = await page.evaluate(() => document.querySelectorAll('.frow').length);
  // click a friend's name → popout
  await page.evaluate(() => document.querySelector('.frow .who')?.click());
  await new Promise(r => setTimeout(r, 800));
  const pop = await page.evaluate(() => {
    const p = document.querySelector('.upop, .user-popout, [class*="popout"]');
    return p ? p.textContent.slice(0, 140) : null;
  });
  console.log(JSON.stringify({ rows, pop }, null, 2));
}
