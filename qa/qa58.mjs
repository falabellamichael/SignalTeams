export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1800);
  out.memberCol = await page.evaluate(() =>
    [...document.querySelectorAll('.members .mrow .n')].map((n) => n.innerText));
  out.authorNames = await page.evaluate(() =>
    [...document.querySelectorAll('.msg .author')].slice(-5).map((a) => a.innerText));
  // open settings → notif row
  await page.evaluate(() =>
    [...document.querySelectorAll('.me-bar .ghost')][0]?.click());
  await page.waitForTimeout(700);
  out.notifRow = await page.evaluate(() =>
    [...document.querySelectorAll('.set-row .lab')].map((l) => l.innerText.split('\n')[0]));
  out.notifCtl = await page.evaluate(() =>
    document.querySelector('.set-row button, .set-row .idehint')?.innerText);
  await page.screenshot({ path: 'D:/AgentHive/qa-nick.png' });
  return out;
}
