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
  // real playwright click on the spoiler element
  const s = page.locator('.md-spoiler').first();
  const cnt = await s.count();
  if (cnt) {
    await s.click();
    await page.waitForTimeout(300);
    return {
      count: cnt,
      hasOpen: await page.evaluate(() => document.querySelector('.md-spoiler')?.classList.contains('open')),
      color: await page.evaluate(() => getComputedStyle(document.querySelector('.md-spoiler')).color),
    };
  }
  return { count: 0 };
}
