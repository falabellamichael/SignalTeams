export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  // Buzz is the default home view
  out.buzzLine = await page.evaluate(() =>
    [...document.querySelectorAll('.buzz-item .bt')]
      .find((b) => b.innerText.includes('summons'))?.innerText || null);
  await page.screenshot({ path: 'D:/AgentHive/qa-buzz-answered2.png' });
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
