export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);

  // REAL right-click on message text
  await page.locator('.msg .text').first().click({ button: 'right' });
  await page.waitForTimeout(600);
  out.menuItems = await page.evaluate(() =>
    [...document.querySelectorAll('.msg-menu .mm-item')].map((i) => i.innerText));
  await page.screenshot({ path: 'D:/AgentHive/qa-ctx-menu3.png' });

  // click Reply → composer banner
  await page.evaluate(() => {
    [...document.querySelectorAll('.msg-menu .mm-item')]
      .find((i) => i.innerText.includes('Reply'))?.click();
  });
  await page.waitForTimeout(500);
  out.replyBanner = await page.evaluate(() =>
    document.querySelector('.reply-banner')?.innerText?.replace(/\n/g, ' ').slice(0, 70) || null);
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
