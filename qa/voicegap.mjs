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
  await new Promise(r => setTimeout(r, 1200));
  const navs = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map(n => (n.textContent || '').trim().slice(0, 40)));
  await page.evaluate(() => {
    [...document.querySelectorAll('.nav-item')].find(n => /voice/i.test(n.textContent || ''))?.click();
  });
  await new Promise(r => setTimeout(r, 1500));
  const info = await page.evaluate(() => {
    const core = document.querySelector('.chat-core');
    const msgs = document.querySelector('.msgs');
    const dump = (el) => el ? [...el.children].map(c => ({
      cls: (typeof c.className === 'string' ? c.className : '').slice(0, 50),
      h: Math.round(c.getBoundingClientRect().height),
      disp: getComputedStyle(c).display,
      txt: (c.textContent || '').trim().slice(0, 35) })) : null;
    return {
      navs,
      hasMsgs: !!msgs,
      msgsStyle: msgs ? { display: getComputedStyle(msgs).display,
        justify: getComputedStyle(msgs).justifyContent,
        flexDir: getComputedStyle(msgs).flexDirection,
        h: Math.round(msgs.getBoundingClientRect().height),
        scrollH: msgs.scrollHeight } : null,
      coreKids: dump(core),
      msgsKids: dump(msgs)?.slice(0, 8),
    };
  });
  console.log(JSON.stringify(info, null, 1));
}
