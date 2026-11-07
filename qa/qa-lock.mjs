export default async function run(page, ui) {
  const out = {};
  // gate #general to mods as mike via API
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mike', password: 'password' }) });
    const mt = (await lr.json()).token;
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mt };
    const sv = await (await fetch('/api/servers/1', { headers: h })).json();
    const gen = sv.channels.find((c) => c.name === 'general');
    const mods = sv.roles.find((r) => r.name === 'mods');
    await fetch(`/api/channels/${gen.id}`, { method: 'PATCH', headers: h,
      body: JSON.stringify({ role_id: mods.id }) });
  });
  // login as juno (no roles)
  await page.waitForSelector('input', { timeout: 25000 });
  const hasLogin = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="password"]')].length > 0);
  if (hasLogin) {
    await page.fill('input >> nth=0', 'juno');
    await page.fill('input[type="password"]', 'password');
    await page.click('button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  out.sidebar = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map((r) => ({
      hash: r.querySelector('.ch-hash')?.innerText,
      name: r.querySelector('.txt')?.innerText,
    })));
  // click the locked #general
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);
  out.lockState = await page.evaluate(() => ({
    empty: document.querySelector('.msgs .empty .serif')?.innerText,
    body: document.querySelector('.msgs .empty')?.innerText,
    composer: !!document.querySelector('.composer textarea'),
  }));
  // restore: ungate
  await page.evaluate(async () => {
    const lr = await fetch('/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mike', password: 'password' }) });
    const mt = (await lr.json()).token;
    const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mt };
    const sv = await (await fetch('/api/servers/1', { headers: h })).json();
    const gen = sv.channels.find((c) => c.name === 'general');
    await fetch(`/api/channels/${gen.id}`, { method: 'PATCH', headers: h,
      body: JSON.stringify({ role_id: 0 }) });
  });
  await page.waitForTimeout(1500);
  out.afterUngate = await page.evaluate(() => ({
    hash: [...document.querySelectorAll('.nav-item')]
      .find((r) => r.querySelector('.txt')?.innerText.trim() === 'general')
      ?.querySelector('.ch-hash')?.innerText,
    composer: !!document.querySelector('.composer textarea'),
  }));
  return out;
}
