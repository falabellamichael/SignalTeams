export default async function run(page, ui) {
  const out = {};
  const tok = await page.evaluate(() => localStorage.getItem('signalteams.token'));
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1000);

  // pre-mute #general via API as mike
  await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    const me = await (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } })).json();
    await fetch('/api/me', { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: [1] }) });
    location.reload();
  });
  await page.waitForTimeout(1800);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(800);

  const row = () => page.evaluate(() => {
    const r = [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'));
    return r ? { muted: !!r.querySelector('.ch-mute.on'), badge: r.querySelector('.cnt')?.innerText ?? null } : null;
  });
  out.before = await row();

  // juno posts into #general while mike is on another channel
  await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    const lr = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'juno', password: 'password' }) });
    const jt = (await lr.json()).token;
    await fetch('/api/channels/2/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + jt, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'unmute-probe' }) });
    await fetch('/api/channels/1/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + jt, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'mute-probe: this should NOT badge' }) });
  });
  await page.waitForTimeout(1500);
  out.afterMsg = await row();   // muted #general → still no badge
  const stRow = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('show-and-tell'));
    return r ? r.querySelector('.cnt')?.innerText ?? null : null;
  });
  out.otherChannelBadge = stRow;  // #show-and-tell → badge should appear
  await page.screenshot({ path: 'D:/AgentHive/qa-mute.png' });

  // unmute → badge appears
  await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    await fetch('/api/me', { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: [] }) });
    location.reload();
  });
  await page.waitForTimeout(1800);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(800);
  out.afterUnmute = await row();
  return out;
}
