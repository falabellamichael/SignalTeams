export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(2000);
  out.railIcons = await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].map((i) => i.title));
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(2000);
  out.navItems = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')].map((t) => t.innerText.trim()));
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1500);
  out.composer = await page.evaluate(() => !!document.querySelector('.composer'));
  out.composerBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.composer button')].map((b) => b.title || b.innerText.trim()));
  out.bodyHead = await page.evaluate(() => document.body.innerText.slice(0, 400));
  await page.screenshot({ path: 'D:/AgentHive/qa-diag.png' });
  return out;
}
