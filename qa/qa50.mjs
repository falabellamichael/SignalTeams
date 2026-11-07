export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('midnight'))?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.gt-btn')?.click());
  await page.waitForTimeout(800);
  out.modal = await page.evaluate(() => ({
    title: document.querySelector('.modal h3')?.innerText,
    sub: document.querySelector('.modal .msub')?.innerText,
    rows: [...document.querySelectorAll('.pack-agent b')].map((b) => b.innerText),
    btn: document.querySelector('.mfoot .primary')?.innerText }));
  // pick nova → Add
  await page.evaluate(() => document.querySelector('.pack-agent')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.mfoot .primary')?.click());
  await page.waitForTimeout(1800);
  out.after = await page.evaluate(() => ({
    members: [...document.querySelectorAll('.members .mrow .n')].map((n) => n.innerText),
    modalGone: !document.querySelector('.modal') }));
  await page.screenshot({ path: 'D:/AgentHive/qa-gdm-add.png' });
  return out;
}
