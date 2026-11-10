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
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await page.waitForSelector('.msg', { timeout: 8000 });
  // right-click the first message
  await page.evaluate(() => {
    const m = document.querySelector('.msg');
    m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }));
  });
  await new Promise(r => setTimeout(r, 500));
  const out = {};
  out.menuOpen = await page.evaluate(() => !!document.querySelector('.msg-menu'));
  out.focused = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30));
  await page.keyboard.press('ArrowDown');
  out.afterDown = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 30));
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));
  out.closedAfterEsc = await page.evaluate(() => !document.querySelector('.msg-menu'));
  console.log(JSON.stringify(out));
}
