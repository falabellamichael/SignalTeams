export default async function (page, ctx) {
  for (const t of await page.$$('button')) {
    if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  await inputs[0].type('mike'); await inputs[1].type('password');
  for (const b of await page.$$('button')) {
    const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase();
    if (t.includes('sign') || t.includes('log')) { await b.click(); break; }
  }
  await page.waitForSelector('.rail', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2500));
  // home first (default), find nav-items containing an avatar span (DM rows)
  const dmCount = await page.evaluate(() => document.querySelectorAll('.nav-item .av, .nav-item .gdm-ico').length);
  await page.evaluate(() => {
    [...document.querySelectorAll('.nav-item')].find(n => n.querySelector('.av, .gdm-ico'))?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  const ok = await page.evaluate(() => !!document.querySelector('.composer textarea'));
  // type + send a DM message
  let sent = false;
  if (ok) {
    await page.click('.composer textarea');
    await page.keyboard.type('dm smoke test');
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));
    sent = await page.evaluate(() => [...document.querySelectorAll('.msg')].some(m => (m.textContent || '').includes('dm smoke test')));
  }
  console.log(JSON.stringify({ dmCount, ok, sent }));
}
