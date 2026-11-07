export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(800);
  // token key changed → should land on the rebranded login
  out.landing = await page.evaluate(() => ({
    h1: document.querySelector('.pitch h1')?.innerText,
    bee: document.querySelector('.bee')?.innerText,
    title: document.title,
  }));
  await shot("st-landing");

  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1400);
  out.sideName = await page.evaluate(() =>
    document.querySelector('.side-head .name')?.innerText);
  out.railIcon = await page.evaluate(() =>
    document.querySelector('.rail-ico')?.innerText.trim());
  // server rail icon should now be 📡 Signal HQ
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1000);
  out.serverHead = await page.evaluate(() =>
    document.querySelector('.side-head .name')?.innerText);
  out.manifest = await page.evaluate(async () =>
    (await (await fetch('/manifest.webmanifest')).json()).short_name);
  await shot("st-home");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
