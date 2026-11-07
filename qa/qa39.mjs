export default async function run(page, ui) {
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1200);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('show-and-tell'))?.click();
  });
  await page.waitForTimeout(1200);
  await page.locator('.md-spoiler').first().click();
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.md-h')?.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'D:/AgentHive/qa-md2.png' });
  // huddle button visual on agent-drops
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('agent-drops'))?.click();
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'D:/AgentHive/qa-huddle.png' });
  return { huddleBtn: await page.locator('.r-huddle').count() };
}
