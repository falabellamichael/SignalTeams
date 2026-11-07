export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  if (await page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].length > 0)) {
    await page.fill('input >> nth=0', 'mike');
    await page.fill('input[type="password"]', 'password');
    await page.click('button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  out.gearCount = await page.evaluate(() => document.querySelectorAll('.srv-gear').length);
  await page.evaluate(() => document.querySelector('.srv-gear')?.click());
  await page.waitForTimeout(800);
  out.modalOpen = await page.evaluate(() =>
    [...document.querySelectorAll('.modal')].map((m) => m.querySelector('.mtitle')?.innerText || m.innerText.slice(0, 40)));
  out.labels = await page.evaluate(() =>
    [...document.querySelectorAll('.modal label')].map((l) => l.innerText.slice(0, 30)));
  out.thresh = await page.evaluate(() => {
    const inp = document.querySelector('.modal input[type="number"]');
    return inp?.value ?? null;
  });
  if (out.thresh !== null) {
    await page.evaluate(() => {
      const inp = document.querySelector('.modal input[type="number"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, '5'); inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() =>
      [...document.querySelectorAll('.modal button')]
        .find((b) => b.innerText.includes('Save'))?.click());
    await page.waitForTimeout(800);
  }
  out.saved = await page.evaluate(async () => {
    const tok = localStorage.getItem('signalteams.token');
    const s = await fetch('/api/servers/1', { headers: { Authorization: 'Bearer ' + tok } })
      .then((r) => r.json()).catch(() => null);
    return s?.star_threshold ?? 'fail';
  });
  await page.evaluate(async () => {
    const tok = localStorage.getItem('signalteams.token');
    await fetch('/api/servers/1', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ star_threshold: 3 }) });
  });
  return out;
}
