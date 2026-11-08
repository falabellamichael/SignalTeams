// verify: non-owner gets the slim member rail + Leave footer
export default async function (page, ctx) {
  for (const t of await page.$$('button')) {
    if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  await inputs[0].type('nova'); await inputs[1].type('password');
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
  await new Promise(r => setTimeout(r, 1500));
  // non-owner gets a "Leave server" door icon — but the settings modal is still reachable?
  await page.evaluate(() =>
    [...document.querySelectorAll('.srv-gear')]
      .find(b => /settings|leave/i.test(b.getAttribute('title') || ''))?.click());
  await new Promise(r => setTimeout(r, 1500));
  const out = await page.evaluate(() => ({
    railBtns: [...document.querySelectorAll('.set-rail button')].map(e => e.getAttribute('title')),
    head: document.querySelector('.set-head h3')?.textContent?.trim(),
    foot: [...document.querySelectorAll('.set-foot button')].map(e => e.textContent.trim()),
    ownerOnly: [...document.querySelectorAll('.set-body label')].map(e => e.textContent.trim().slice(0, 30)),
  }));
  console.log(JSON.stringify(out, null, 2));
  await page.screenshot({ path: 'qa/shots/srvsettings-member.png' });
}
