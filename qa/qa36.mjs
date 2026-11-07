export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForFunction(() => window.__st && window.__st.me, { timeout: 25000 });
  out.st1 = await page.evaluate(() => JSON.stringify({ me: window.__st.me?.username, muted: window.__st.me?.muted, unread: window.__st.unread }));
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'mike', password: 'password' }) });
    const mt = (await lr.json()).token;
    const r = await fetch('/api/channels/2/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + mt, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'ws-probe-2' }) });
    window.__post = r.status;
  });
  out.postStatus = await page.evaluate(() => window.__post);
  await page.waitForTimeout(2500);
  out.st2 = await page.evaluate(() => JSON.stringify(window.__st));
  return out;
}
