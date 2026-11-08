// verify: member-list click on a real user → popout with mutual servers/friends
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
  await new Promise(r => setTimeout(r, 1500));

  // click Nova's member-list row
  const clicked = await page.evaluate(() => {
    for (const row of document.querySelectorAll('.mrow')) {
      const n = row.querySelector('.n');
      if (n && /nova/i.test(n.textContent)) { row.click(); return n.textContent.trim(); }
    }
    return null;
  });
  await new Promise(r => setTimeout(r, 1400));
  const pop = await page.evaluate(() => {
    const el = document.querySelector('.user-pop');
    if (!el) return null;
    return {
      name: el.querySelector('.upop-name')?.textContent,
      handle: el.querySelector('.upop-handle')?.textContent,
      secs: [...el.querySelectorAll('.upop-sec-title')].map(e => e.textContent),
      servers: [...el.querySelectorAll('.upop-row-name')].map(e => e.textContent),
      friends: [...el.querySelectorAll('.upop-fname')].map(e => e.textContent),
      actions: el.querySelectorAll('.upop-btn').length,
    };
  });
  console.log(JSON.stringify({ clicked, pop }, null, 2));
  await page.screenshot({ path: 'qa/shots/userpop-nova.png' });
}
