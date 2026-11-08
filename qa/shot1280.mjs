export default async function run(page, ui) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(600);
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
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "D:/AgentHive/qa-1280.png" });
  return await page.evaluate(() => ({
    vw: innerWidth, vh: innerHeight,
    side: Math.round(document.querySelector(".ws-side")?.getBoundingClientRect().width || 0),
    tabs: document.querySelectorAll(".ws-tab").length,
  }));
}
