export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1800);

  // the "test crew" group from the API test should already be in the DM list
  out.dmRows = await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')].map((r) => r.innerText.trim().slice(0, 40)));
  // open the group DM
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('test crew'))?.click();
  });
  await page.waitForTimeout(1600);
  out.title = await page.evaluate(() => document.querySelector('.topbar .title')?.innerText);
  out.memberCol = await page.evaluate(() =>
    [...document.querySelectorAll('.members .mrow .n')].map((n) => n.innerText));
  out.placeholder = await page.evaluate(() =>
    document.querySelector('textarea')?.placeholder);
  // send a message in the group
  const ta = page.locator('textarea').last();
  await ta.fill('group dm works, crew');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1400);
  out.sent = await page.evaluate(() =>
    [...document.querySelectorAll('.msg')].at(-1)?.innerText.includes('group dm works'));
  await page.screenshot({ path: 'D:/AgentHive/qa-gdm.png' });
  return out;
}
