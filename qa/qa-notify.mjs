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
  // hover #show-and-tell row → cycle button
  const stateOf = async () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    const b = row?.querySelector('.ch-mute');
    return b ? { cls: b.className, icon: b.innerText, tip: b.title } : null;
  });
  const clickBtn = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    row?.querySelector('.ch-mute')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  out.s0 = await stateOf();
  await clickBtn(); await page.waitForTimeout(600); out.s1 = await stateOf();
  await clickBtn(); await page.waitForTimeout(600); out.s2 = await stateOf();
  await clickBtn(); await page.waitForTimeout(600); out.s3 = await stateOf();
  // verify me state after cycling back to default
  out.meState = await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    const me = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } }).then(r => r.json());
    return { muted: me.muted, notify_mentions: me.notify_mentions };
  });
  await page.screenshot({ path: 'D:/AgentHive/qa-notify.png' });

  // functional: set mention-only on #show-and-tell, post a plain msg → no unread badge;
  // then an @mike mention → @ badge appears
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    row?.querySelector('.ch-mute')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(500);  // now state 1
  // sit in #general so show-and-tell unread can accrue
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'juno', password: 'password' }) });
    const jt = (await lr.json()).token;
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jt };
    await fetch('/api/channels/2/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: 'plain unread probe' }) });
    await fetch('/api/channels/2/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: '@mike mention probe' }) });
  });
  await page.waitForTimeout(1200);
  out.badges = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    return [...(row?.querySelectorAll('.cnt') || [])].map((c) => c.innerText);
  });
  await page.screenshot({ path: 'D:/AgentHive/qa-notify-badge.png' });
  // cleanup: cycle back to default
  await clickBtn(); await clickBtn();
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
