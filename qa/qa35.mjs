export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForFunction(() => window.__st?.me, { timeout: 25000 });
  await page.waitForTimeout(2000);

  // open Signal HQ, stay on #general (active) — then probe badges via OTHER channels
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1200);

  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')].map((r) => ({
      name: r.innerText.trim().split('\n').filter((x) => x && !/^\d+$/.test(x))[0],
      badge: r.querySelector('.cnt')?.innerText ?? null,
      muted: !!r.querySelector('.ch-mute.on'),
    })));

  // mute #agent-drops via the real UI: hover row → click 🔕
  const agentRow = page.locator('.side-body .nav-item', { hasText: 'agent-drops' });
  await agentRow.hover();
  await page.waitForTimeout(300);
  await agentRow.locator('.ch-mute').click();
  await page.waitForTimeout(800);
  out.afterMute = await rows();

  // mike posts into BOTH channels — juno is viewing #general (active), so both should increment
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mike', password: 'password' }) });
    const mt = (await lr.json()).token;
    for (const [cid, txt] of [[2, 'probe-muted'], [3, 'probe-unmuted']]) {
      const r = await fetch(`/api/channels/${cid}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + mt, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: txt }) });
      window['__p' + cid] = r.status;
    }
  });
  out.posts = await page.evaluate(() => [window.__p2, window.__p3]);
  await page.waitForTimeout(2500);
  out.stateAfterPosts = await page.evaluate(() => JSON.stringify({ unread: window.__st?.unread, muted: window.__st?.me?.muted }));
  out.rowsAfterPosts = await rows();
  await page.screenshot({ path: 'D:/AgentHive/qa-mute2.png' });

  // unmute via UI → stored unread for agent-drops should now badge
  await agentRow.hover();
  await page.waitForTimeout(300);
  await agentRow.locator('.ch-mute').click();
  await page.waitForTimeout(800);
  out.afterUnmute = await rows();
  return out;
}
