export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // open the "midnight crew" group DM
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('midnight'))?.click());
  await page.waitForTimeout(1600);
  out.title = await page.evaluate(() => document.querySelector('.topbar .title')?.innerText);
  out.tools = await page.evaluate(() => !!document.querySelector('.gdm-tools'));
  out.memberN = await page.evaluate(() =>
    [...document.querySelectorAll('.members .mrow .n')].map((n) => n.innerText));
  // click ＋ add → modal opens with pickable friends
  await page.evaluate(() => document.querySelector('.gt-btn')?.click());
  await page.waitForTimeout(700);
  out.modal = await page.evaluate(() => ({
    title: document.querySelector('.modal h2, .modal .mtitle')?.innerText,
    rows: [...document.querySelectorAll('.pack-agent b')].map((b) => b.innerText) }));
  await page.screenshot({ path: 'D:/AgentHive/qa-gdm-tools.png' });
  return out;
}
