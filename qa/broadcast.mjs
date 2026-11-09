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
  await page.click('.composer textarea');
  await page.keyboard.type('@ever');
  await new Promise(r => setTimeout(r, 700));
  const pop = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim()));
  await page.keyboard.press('Escape');
  await page.keyboard.type('@her');
  await new Promise(r => setTimeout(r, 700));
  const pop2 = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim()));
  // pick it and send to confirm backend accepts
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 400));
  const draft = await page.evaluate(() => document.querySelector('.composer textarea').value);
  console.log(JSON.stringify({ pop, pop2, draft }, null, 2));
}
