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
  await new Promise(r => setTimeout(r, 2500));
  const seen = {};
  // Buzz (already there) → server → DM → friends → saved
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  seen.server = await page.evaluate(() => !!document.querySelector('.composer textarea'));
  // click the first DM in home sidebar
  await page.evaluate(() => document.querySelector('.rail-ico')?.click()); // home
  await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(() => document.querySelector('.nav-item')?.click());
  await new Promise(r => setTimeout(r, 1200));
  seen.dm = await page.evaluate(() => !!document.querySelector('.composer textarea'));
  // friends view
  await page.evaluate(() => [...document.querySelectorAll('.nav-item')].find(n => (n.textContent || '').toLowerCase().includes('friend'))?.click());
  await new Promise(r => setTimeout(r, 1200));
  seen.friends = await page.evaluate(() => document.body.textContent.includes('friend') || document.body.textContent.includes('Friend'));
  console.log(JSON.stringify(seen));
}
