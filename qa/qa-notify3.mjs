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
  const clickBtn = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    row?.querySelector('.ch-mute')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const stateOf = () => page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    return row?.querySelector('.ch-mute')?.className;
  });
  // currently s2 (muted) → one click → s0; next → s1 mention-only
  await clickBtn(); await page.waitForTimeout(500);
  await clickBtn(); await page.waitForTimeout(500);
  out.state = await stateOf();   // expect s1
  // into #general so unread can accrue on show-and-tell
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
    await fetch('/api/channels/3/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: 'plain msg — should NOT badge' }) });
    await fetch('/api/channels/3/messages', { method: 'POST', headers: h,
      body: JSON.stringify({ content: '@mike this SHOULD badge' }) });
  });
  await page.waitForTimeout(1500);
  out.badges = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('show-and-tell'));
    return [...(row?.querySelectorAll('.cnt') || [])].map((c) => c.innerText + ':' + c.className);
  });
  await page.screenshot({ path: 'D:/AgentHive/qa-notify-badge.png' });
  // restore default
  await clickBtn(); await clickBtn();
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
