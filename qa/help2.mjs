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
  await page.waitForSelector('.composer textarea', { timeout: 8000 });
  await new Promise(r => setTimeout(r, 1200));

  // /8 autocomplete shows the new commands
  await page.click('.composer textarea');
  await page.keyboard.type('/8');
  await new Promise(r => setTimeout(r, 600));
  const ac8 = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim()));
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));

  // blur composer then press ? — shortcuts modal opens
  await page.evaluate(() => document.activeElement?.blur());
  await page.evaluate(() => document.body.click());
  await new Promise(r => setTimeout(r, 300));
  await page.keyboard.press('?');
  await new Promise(r => setTimeout(r, 800));
  const sc = await page.evaluate(() => ({
    open: !!document.querySelector('.sc-grid'),
    kbd: [...document.querySelectorAll('.sc-kbd')].map(e => e.textContent),
    cmds: [...document.querySelectorAll('.sc-cmd')].map(e => e.textContent),
  }));
  console.log(JSON.stringify({ ac8, sc }, null, 2));
}
