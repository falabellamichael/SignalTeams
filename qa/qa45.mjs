export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'nova');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(2000);  // stays on Buzz home — let WS subscribe
  // mike posts two messages to #general while nova isn't in it
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mike', password: 'password' }) });
    const mt = (await lr.json()).token;
    for (const t of ['unread boundary test one', 'unread boundary test two']) {
      await fetch('/api/channels/1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + mt, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: t }) });
    }
  });
  await page.waitForTimeout(1500);
  out.unreadBefore = await page.evaluate(() => window.__st?.unread);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1800);
  out.channel = await page.evaluate(() => document.querySelector('.topbar .title')?.innerText);
  out.divider = await page.evaluate(() => !!document.querySelector('.new-div'));
  out.dividerPos = await page.evaluate(() => {
    const nd = document.querySelector('.new-div');
    if (!nd) return null;
    const r = nd.getBoundingClientRect();
    return { y: Math.round(r.top), inView: r.top > 0 && r.bottom < innerHeight };
  });
  out.msgsAfterDivider = await page.evaluate(() => {
    const nd = document.querySelector('.new-div');
    if (!nd) return -1;
    let n = 0, el = nd.nextElementSibling;
    while (el) { if (el.classList.contains('msg')) n++; el = el.nextElementSibling; }
    return n;
  });
  await page.screenshot({ path: 'D:/AgentHive/qa-newdiv.png' });
  return out;
}
