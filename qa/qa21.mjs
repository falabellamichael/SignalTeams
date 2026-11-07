export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  // topbar search button
  await page.click('button[title="Search everywhere"]');
  await page.waitForTimeout(600);
  await page.fill('.modal input', 'toast');
  await page.waitForTimeout(1200);
  out.hits = await page.evaluate(() =>
    [...document.querySelectorAll('.modal .pack-agent')].map((r) =>
      r.innerText.replace(/\n/g, ' ').slice(0, 90)));
  await shot("global-search");

  // click a result → lands in that channel
  const first = await page.$('.modal .pack-agent');
  if (first) {
    await first.click();
    await page.waitForTimeout(1100);
    out.landed = await page.evaluate(() => ({
      title: document.querySelector('.topbar .title')?.innerText,
      hasMsg: document.body.innerText.includes('toast'),
    }));
    await shot("search-landed");
  }
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
