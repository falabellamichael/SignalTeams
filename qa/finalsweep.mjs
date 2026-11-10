// final regression: login → channel → @/#/: completions → send → reply-jump
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
  const pops = {};
  for (const [k, txt] of [['at', '@nov'], ['chan', '#sta'], ['emo', ':fir'], ['slash', '/po']]) {
    await page.click('.composer textarea');
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type(txt);
    await new Promise(r => setTimeout(r, 650));
    pops[k] = await page.evaluate(() =>
      [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim().slice(0, 40)));
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 250));
  }
  // char counter appears past 3400
  await page.click('.composer textarea');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'x'.repeat(3500));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 400));
  const counter = await page.evaluate(() => document.querySelector('.char-count')?.textContent || null);
  console.log(JSON.stringify({ pops, counter }, null, 2));
}
