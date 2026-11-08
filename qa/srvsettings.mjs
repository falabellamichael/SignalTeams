// verify: ServerSettingsModal opens in paged shell; walk every rail page
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

  // open the server, click the server-settings gear (owner path)
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() =>
    [...document.querySelectorAll('.srv-gear')]
      .find(b => (b.getAttribute('title') || '').includes('Server settings'))?.click());
  await page.waitForSelector('.settings-modal .set-rail', { timeout: 8000 });
  await new Promise(r => setTimeout(r, 800));

  const railInfo = await page.$$eval('.set-rail button', els => els.map(e => ({
    label: e.getAttribute('title'), on: e.classList.contains('on'),
  })));
  const pageInfo = {};
  for (const p of railInfo) {
    await page.evaluate((lbl) => {
      [...document.querySelectorAll('.set-rail button')]
        .find(b => b.getAttribute('title') === lbl)?.click();
    }, p.label);
    await new Promise(r => setTimeout(r, 900));
    pageInfo[p.label] = await page.evaluate(() => ({
      head: document.querySelector('.set-head h3')?.textContent?.trim(),
      labels: [...document.querySelectorAll('.set-body label')].map(e => e.textContent.trim().slice(0, 50)),
      rows: document.querySelectorAll('.set-body .pack-agent').length,
      inputs: document.querySelectorAll('.set-body input').length,
      errs: [...document.querySelectorAll('.idehint')].filter(e => /error|fail/i.test(e.textContent)).length,
    }));
  }
  console.log(JSON.stringify({ railInfo, pageInfo }, null, 2));
  await page.screenshot({ path: 'qa/shots/srvsettings.png' });
}
