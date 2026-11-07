export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // open Signal HQ → lands on a channel; click #general explicitly
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click());
  await page.waitForTimeout(1200);

  // juno @mike in agent-drops (id 2) — mike stays in #general
  await page.evaluate(async () => {
    const j = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'juno', password: 'password' }) }).then((x) => x.json());
    await fetch('/api/channels/2/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.token },
      body: JSON.stringify({ content: 'pinging @mike specifically' }) });
  });
  await page.waitForTimeout(1500);

  out.rows = await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')].map((x) => ({
      t: x.innerText.trim().replace(/\s+/g, ' ').slice(0, 30),
      ping: x.querySelector('.cnt.ping')?.innerText || null,
      cnt: x.querySelector('.cnt:not(.ping)')?.innerText || null })));
  out.rail = await page.evaluate(() => {
    const el = document.querySelector('.rail-ico[title*="Signal HQ"] .rail-badge');
    return el ? { txt: el.innerText, ping: el.classList.contains('ping') } : null; });
  await page.screenshot({ path: 'D:/AgentHive/qa-mention.png' });

  // leave-group test: nova leaves "test crew" via API, mike's DM list should keep it
  out.leave = await page.evaluate(async () => {
    const n = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nova', password: 'password' }) }).then((x) => x.json());
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + n.token };
    const r = await fetch('/api/dms/8/leave', { method: 'POST', headers: h }).then((x) => x.json());
    const dms = await fetch('/api/dms', { headers: h }).then((x) => x.json());
    return { r, stillThere: dms.some((d) => d.id === 8) };
  });
  return out;
}
