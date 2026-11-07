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
      .find((c) => c.innerText.includes('Saved'))?.click());
  await page.waitForSelector('.inbox-row', { timeout: 8000 });
  out.rows = await page.evaluate(() =>
    [...document.querySelectorAll('.inbox-row')].map((r) =>
      r.innerText.trim().replace(/\s+/g, ' ').slice(0, 65)));
  // jump first row → lands in channel with flash
  await page.evaluate(() => document.querySelector('.inbox-row .ib-jump')?.parentElement?.click() ??
    document.querySelector('.inbox-row')?.click());
  await page.waitForTimeout(1800);
  out.jump = await page.evaluate(() => ({
    title: document.querySelector('.topbar .title')?.innerText,
    flash: !!document.querySelector('.flash') }));
  await page.screenshot({ path: 'D:/AgentHive/qa-saved.png' });
  return out;
}
