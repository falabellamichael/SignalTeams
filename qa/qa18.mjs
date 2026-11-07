export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);

  await page.click('.srv-gear');
  await page.waitForTimeout(600);
  out.modalTitle = await page.evaluate(() => document.querySelector('.modal h3')?.innerText);
  out.hasRotate = await page.evaluate(() =>
    !!([...document.querySelectorAll('.modal button')].find((b) => b.innerText.includes('rotate'))));
  await shot("srv-settings");
  // rename
  await page.fill('.modal input >> nth=0', 'The Hive ✦');
  await page.click('.modal button.primary');
  await page.waitForTimeout(800);
  out.newName = await page.evaluate(() => document.querySelector('.side-head .name')?.innerText);
  await shot("srv-renamed");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
