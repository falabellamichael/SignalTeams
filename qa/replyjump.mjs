// verify: reply-quote click jumps to original message
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

  // post a message, then hover → reply → send a reply to it
  const tag = 'rjq-' + Date.now().toString(36);
  await page.click('.composer textarea');
  await page.keyboard.type(tag);
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1600));

  // hover the last message to reveal the react-bar, click Reply
  const replied = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg')];
    const mine = msgs.filter(m => m.textContent.includes('rjq-')).pop();
    if (!mine) return 'no-msg';
    mine.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bar = mine.querySelector('.react-bar');
    const btn = bar && [...bar.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Reply');
    if (!btn) return 'no-reply-btn';
    btn.click();
    return 'clicked';
  });
  await new Promise(r => setTimeout(r, 600));
  const banner = await page.evaluate(() => document.querySelector('.reply-banner')?.textContent || null);

  // send the reply
  await page.keyboard.type('this is the reply');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1600));

  // click the .reply-quote on the newest message
  const clickRes = await page.evaluate(() => {
    const qs = [...document.querySelectorAll('.reply-quote.jumpable')];
    if (!qs.length) return 'no-jumpable-quote';
    qs[qs.length - 1].click();
    return 'clicked ' + qs.length;
  });
  await new Promise(r => setTimeout(r, 1200));
  const flashed = await page.evaluate(() => {
    const f = document.querySelector('.msg.flash, .flash');
    return f ? { found: true, text: f.textContent.slice(0, 60) } : { found: false };
  });

  console.log(JSON.stringify({ replied, banner, clickRes, flashed }, null, 2));
}
