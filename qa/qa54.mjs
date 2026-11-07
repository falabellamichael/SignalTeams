export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // MeBar should show status text now
  out.mebar = await page.evaluate(() =>
    document.querySelector('.me-bar .s')?.innerText);
  // open server settings → members list with kick buttons
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.srv-gear')?.click());
  await page.waitForTimeout(800);
  out.members = await page.evaluate(() =>
    [...document.querySelectorAll('.pack-agent')].map((r) => ({
      n: r.querySelector('b')?.innerText, kick: !!r.querySelector('.stat.kick') })));
  await page.screenshot({ path: 'D:/AgentHive/qa-srv-members.png' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.shade')?.click());
  return out;
}
