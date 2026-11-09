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
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('Friends'));
    it?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => document.querySelector('.frow .who')?.click());
  await new Promise(r => setTimeout(r, 900));
  const pop = await page.evaluate(() => {
    const p = document.querySelector('.user-pop');
    return p ? {
      name: p.querySelector('.upop-name')?.textContent,
      secs: [...p.querySelectorAll('.upop-sec-title')].map(e => e.textContent),
      acts: [...p.querySelectorAll('.upop-act, .upop-acts *')].map(e => e.textContent).filter(Boolean).slice(0, 6),
    } : null;
  });
  console.log(JSON.stringify({ pop }, null, 2));
}
