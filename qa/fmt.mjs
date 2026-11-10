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
  await page.waitForSelector('.composer textarea', { timeout: 8000 });
  const set = (v, s, e) => page.evaluate(([v, s, e]) => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus(); ta.selectionStart = s; ta.selectionEnd = e;
  }, [v, s, e]);
  const val = () => page.evaluate(() => document.querySelector('.composer textarea').value);
  const out = {};
  await set('hello world', 6, 11);            // select "world"
  await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200)); out.wrap = await val();
  await set('hello **world**', 6, 15);        // select inside the marks
  await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200)); out.unwrapInner = await val();
  await set('hello **world** again', 6, 15);  // select marks+content
  await page.keyboard.down('Control'); await page.keyboard.press('b'); await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200)); out.unwrapOuter = await val();
  await set('', 0, 0);
  await page.keyboard.down('Control'); await page.keyboard.press('`'); await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 200)); out.codeEmpty = await val();
  console.log(JSON.stringify(out));
}
