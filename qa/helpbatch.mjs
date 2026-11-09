// verify: shortcuts modal truthfulness, /8ball, /clear
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

  // 1 · /8ball posts a magic-8 answer
  await page.click('.composer textarea');
  await page.keyboard.type('/8ball will it ship');
  await new Promise(r => setTimeout(r, 500));
  const ac = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim()));
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1600));
  const ball = await page.evaluate(() =>
    [...document.querySelectorAll('.msg')].pop()?.textContent.slice(0, 80));

  // 2 · /clear empties a filled composer
  await page.click('.composer textarea');
  await page.keyboard.type('draft text to clear');
  await page.evaluate(() => { // set draft reliably via keyboard
    const ta = document.querySelector('.composer textarea'); ta.focus();
  });
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.type('/clear');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));
  const afterClear = await page.evaluate(() => document.querySelector('.composer textarea').value);

  // 3 · ? opens the shortcuts modal — check rows
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: '?', bubbles: true });
    window.dispatchEvent(ev);
  });
  await new Promise(r => setTimeout(r, 700));
  const sc = await page.evaluate(() => ({
    open: !!document.querySelector('.sc-grid'),
    kbd: [...document.querySelectorAll('.sc-kbd')].map(e => e.textContent),
    cmds: [...document.querySelectorAll('.sc-cmd')].map(e => e.textContent),
  }));
  await page.keyboard.press('Escape');

  console.log(JSON.stringify({ ac, ball, afterClear, sc }, null, 2));
}
