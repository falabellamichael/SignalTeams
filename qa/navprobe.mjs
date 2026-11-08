export default async function (page, ctx) {
  for (const t of await page.$$('button')) {
    if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  await inputs[0].type('mike'); await inputs[1].type('password');
  for (const b of await page.$$('button')) {
    const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase();
    if (t.includes('sign') || t.includes('log') || t.includes('continue')) { await b.click(); break; }
  }
  await page.waitForSelector('.rail', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2500));
  const nav = await page.$$eval('.nav-item', els => els.map(e => e.textContent.trim().slice(0, 40)));
  const info = await page.evaluate(async () => {
    const tok = localStorage.getItem('signalteams.token');
    const servers = await (await fetch('/api/servers', { headers: { authorization: 'Bearer ' + tok } })).json();
    return servers.map(s => ({ id: s.id, name: s.name, chans: (s.channels || []).map(c => `${c.kind}:${c.name}`) }));
  });
  console.log(JSON.stringify({ nav, info }, null, 2));
}
