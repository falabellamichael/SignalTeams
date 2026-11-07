export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1200);

  // right-click a known message → Forward
  const msg = page.locator('.msg', { hasText: 'mute-probe' }).first();
  await msg.click({ button: 'right' });
  await page.waitForTimeout(400);
  const fwd = page.locator('.mm-item', { hasText: 'Forward' });
  out.menuHasFwd = await fwd.count();
  await fwd.click();
  await page.waitForTimeout(900);
  out.destinations = await page.evaluate(() =>
    [...document.querySelectorAll('.modal .ideopt')].map((o) => o.innerText.trim()));
  // pick show-and-tell
  await page.locator('.modal .ideopt', { hasText: 'show-and-tell' }).first().click();
  await page.waitForTimeout(1600);
  out.landed = await page.evaluate(() =>
    document.querySelector('.topbar .title')?.innerText);
  out.fwdTag = await page.evaluate(() =>
    document.querySelector('.fwd-tag')?.innerText ?? null);
  await page.screenshot({ path: 'D:/AgentHive/qa-fwd.png' });
  // click the tag → jumps back to original in #general
  await page.click('.fwd-tag');
  await page.waitForTimeout(1800);
  out.backAt = await page.evaluate(() =>
    document.querySelector('.topbar .title')?.innerText);
  out.flashed = await page.evaluate(() => !!document.querySelector('.msg.flash'));
  return out;
}
