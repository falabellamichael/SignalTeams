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
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await page.waitForSelector('.msgs', { timeout: 8000 });
  await new Promise(r => setTimeout(r, 1500));
  const clickCh = async (name) => page.evaluate((n) => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes(n));
    it?.click(); return !!it;
  }, name);

  // current channel (loaded by default) — scroll well off bottom
  const cur = await page.evaluate(() => {
    const m = document.querySelector('.msgs'); m.scrollTop = Math.max(200, m.scrollHeight - m.clientHeight - 400);
    return m.scrollTop;
  });
  await new Promise(r => setTimeout(r, 400));
  const posA = await page.evaluate(() => document.querySelector('.msgs').scrollTop);

  // jump to #starboard (real channel), then back via the sidebar's .on item name
  await clickCh('starboard');
  await new Promise(r => setTimeout(r, 1600));
  // back to previous channel — find which nav-item was 'on' before: click #general explicitly
  await clickCh('general');
  await new Promise(r => setTimeout(r, 1600));
  const posBack = await page.evaluate(() => {
    const m = document.querySelector('.msgs');
    return { top: m.scrollTop, atBottom: m.scrollHeight - m.scrollTop - m.clientHeight < 120 };
  });
  console.log(JSON.stringify({ cur, posA, posBack }, null, 2));
}
