export default async function run(page, ui) {
  const out = {};
  // login as mike — stay on Buzz so #general mention counts as "not active"
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1600);

  // juno mentions mike in #general + posts plain msg in #show-and-tell
  const r = await page.evaluate(async () => {
    const j = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'juno', password: 'password' }) }).then((x) => x.json());
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.token };
    const a = await fetch('/api/channels/1/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: 'hey @mike look at this' }) }).then((x) => x.json());
    const b = await fetch('/api/channels/2/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: 'plain unread, no mention' }) }).then((x) => x.json());
    return { a: a.id, b: b.id };
  });
  out.posted = r;
  await page.waitForTimeout(1500);

  // mike's sidebar: server rail badge should be @1; home shows nothing (we're home)
  // → click the server icon to see channel rows
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1600);
  out.rows = await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')].map((x) => ({
      t: x.innerText.trim().split('\n')[0],
      ping: !!x.querySelector('.cnt.ping'),
      cnt: x.querySelector('.cnt')?.innerText })));
  out.railBadge = await page.evaluate(() =>
    document.querySelector('.rail-ico[title*="Signal HQ"] .rail-badge')?.innerText || null);
  out.railPing = await page.evaluate(() =>
    !!document.querySelector('.rail-ico[title*="Signal HQ"] .rail-badge.ping'));
  await page.screenshot({ path: 'D:/AgentHive/qa-mention.png' });
  return out;
}
