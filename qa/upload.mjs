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
  await new Promise(r => setTimeout(r, 1500));
  const fi = await page.$('input[type="file"]');
  await fi.setInputFiles('D:/AgentHive/frontend/package.json');
  for (let i = 0; i < 20; i++) {
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('.att-chip')].map(c => c.textContent.trim()));
    if (chips.length) { console.log('chip@' + i + ':', JSON.stringify(chips)); break; }
    await new Promise(r => setTimeout(r, 200));
  }
  await new Promise(r => setTimeout(r, 1200));
  console.log('final:', await page.evaluate(() =>
    [...document.querySelectorAll('.att-chip')].map(c => JSON.stringify({
      txt: c.textContent.trim(), uploading: c.className.includes('uploading'),
      hasThumb: !!c.querySelector('.att-thumb') }))));
}
