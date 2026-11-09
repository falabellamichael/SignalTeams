// verify: #channel completion, ArrowUp-edit, composer autofocus
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

  // 1 · composer autofocus — active element should be the textarea
  const focused = await page.evaluate(() => document.activeElement?.className);

  // 2 · # channel completion
  await page.click('.composer textarea');
  await page.keyboard.type('#gen');
  await new Promise(r => setTimeout(r, 900));
  const pop = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim()));
  // pick it
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));
  const afterPick = await page.evaluate(() => document.querySelector('.composer textarea').value);

  // 3 · send a msg then ArrowUp to edit it
  await page.keyboard.type(' — check this channel', { delay: 15 });
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1500));
  await page.keyboard.press('ArrowUp');
  await new Promise(r => setTimeout(r, 700));
  const editBox = await page.evaluate(() => {
    const el = document.querySelector('.msg textarea, .msg .edit-ta, .msg input');
    return el ? { found: true, value: el.value || el.textContent } : { found: false };
  });

  // 4 · #name link renders as channel jump
  const link = await page.evaluate(() =>
    [...document.querySelectorAll('.md-mention.ch')].map(e => e.textContent).slice(-3));

  console.log(JSON.stringify({ focused, pop, afterPick, editBox, link }, null, 2));
}
