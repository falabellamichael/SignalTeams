export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1800);
  // Buzz should be default view — read filter chips + counts
  out.chips = await page.evaluate(() =>
    [...document.querySelectorAll('.buzz .seg button')].map((b) => b.innerText));
  out.counts = {};
  for (const f of ['🧰 Agents', '👥 People', '✦ Activity']) {
    await page.evaluate((label) =>
      [...document.querySelectorAll('.buzz .seg button')]
        .find((b) => b.innerText === label)?.click(), f);
    await page.waitForTimeout(400);
    out.counts[f] = await page.evaluate(() =>
      document.querySelectorAll('.buzz-item').length);
  }
  await page.evaluate(() =>
    [...document.querySelectorAll('.buzz .seg button')].find((b) => b.innerText === 'All')?.click());
  await page.waitForTimeout(300);
  out.counts.All = await page.evaluate(() => document.querySelectorAll('.buzz-item').length);
  await page.screenshot({ path: 'D:/AgentHive/qa-buzz-filter.png' });
  return out;
}
