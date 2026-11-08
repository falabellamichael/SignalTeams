export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-ws-${n}.png` });
  const out = {};
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1500);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(1800);
  await shot("tree");
  out.names = await page.evaluate(() =>
    [...document.querySelectorAll('.ws-fname')].map((e) => e.innerText));
  out.hasPycache = out.names.some((n) => n.includes("__pycache__"));
  return out;
}
