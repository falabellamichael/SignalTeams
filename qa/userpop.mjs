// verify: click a message author → UserPopout opens with mutuals + actions
export default async function (page, ctx) {
  const report = {};
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

  // open the first server, then first text channel
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').includes('#'));
    if (it) it.click();
  });
  await page.waitForSelector('.msg .author, .msg', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 1000));

  // click a NON-me author (someone else's name → mutuals visible)
  const clicked = await page.evaluate(() => {
    const authors = [...document.querySelectorAll('.msg .author')];
    for (const a of authors) {
      const t = (a.textContent || '').trim();
      if (t && t !== 'mike' && !/mike/i.test(t)) { a.click(); return t; }
    }
    return null;
  });
  await new Promise(r => setTimeout(r, 1200));

  report.clickedAuthor = clicked;
  report.popout = await page.evaluate(() => {
    const el = document.querySelector('.user-pop');
    if (!el) return null;
    return {
      name: el.querySelector('.upop-name')?.textContent,
      handle: el.querySelector('.upop-handle')?.textContent,
      secs: [...el.querySelectorAll('.upop-sec-title')].map(e => e.textContent),
      servers: [...el.querySelectorAll('.upop-row-name')].map(e => e.textContent),
      friends: el.querySelectorAll('.upop-fchip').length,
      actions: el.querySelectorAll('.upop-btn').length,
      rect: el.getBoundingClientRect(),
    };
  });
  await page.screenshot({ path: 'qa/shots/userpop.png' });

  // mutual-server jump — click the first server row → should navigate
  if (report.popout?.servers?.length) {
    await page.evaluate(() => document.querySelector('.upop-row')?.click());
    await new Promise(r => setTimeout(r, 1500));
    report.afterJump = { popoutGone: !(await page.$('.user-pop')) };
  }

  // member-list click too
  await page.evaluate(() => document.querySelector('.mrow')?.click());
  await new Promise(r => setTimeout(r, 1200));
  report.memberPop = !!(await page.$('.user-pop'));

  console.log(JSON.stringify(report, null, 2));
}
