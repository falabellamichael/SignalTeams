export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  // sit in #general; juno posts a plain msg to agent-drops (mention-only? it's in state s1 from last run? verify)
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(800);
  const rowBadge = (name) => page.evaluate((nm) => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.toLowerCase().includes(nm));
    return row ? [...row.querySelectorAll('.cnt')].map((c) => c.innerText)
               + ' | mute:' + row.querySelector('.ch-mute')?.className : 'no row';
  }, name);
  out.dropsBadge = await rowBadge('agent-drops');
  out.stBadge = await rowBadge('show-and-tell');
  // juno posts plain + mention into agent-drops (ch2)
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'juno', password: 'password' }) });
    const jt = (await lr.json()).token;
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jt };
    await fetch('/api/channels/2/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: 'quiet probe one' }) });
    await fetch('/api/channels/2/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: '@mike ping probe' }) });
  });
  await page.waitForTimeout(1500);
  out.dropsBadge2 = await rowBadge('agent-drops');
  await page.screenshot({ path: 'D:/AgentHive/qa-notify-badge.png' });
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
