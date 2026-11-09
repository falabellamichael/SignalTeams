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

  const chans = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map(e => e.textContent.trim()).slice(0, 6));

  // scroll up in channel A
  await page.evaluate(() => { const m = document.querySelector('.msgs'); m.scrollTop = Math.max(150, m.scrollHeight * 0.4); m.dispatchEvent(new Event('scroll')); });
  await new Promise(r => setTimeout(r, 500));
  const posA = await page.evaluate(() => document.querySelector('.msgs').scrollTop);

  // switch to channel B then back to A
  const nav = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.nav-item')];
    if (items.length < 2) return 'too-few';
    items[1].click(); return 'ok';
  });
  await new Promise(r => setTimeout(r, 1800));
  await page.evaluate(() => { [...document.querySelectorAll('.nav-item')][0].click(); });
  await new Promise(r => setTimeout(r, 1800));
  const posBack = await page.evaluate(() => document.querySelector('.msgs').scrollTop);

  // fresh channel B visit → should be at bottom
  await page.evaluate(() => { [...document.querySelectorAll('.nav-item')][1].click(); });
  await new Promise(r => setTimeout(r, 1500));
  const posB = await page.evaluate(() => {
    const m = document.querySelector('.msgs');
    return { top: m.scrollTop, atBottom: m.scrollHeight - m.scrollTop - m.clientHeight < 120 };
  });
  console.log(JSON.stringify({ chans, posA, nav, posBack, posB }, null, 2));
}
