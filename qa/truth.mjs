export default async function run(page, ui) {
  await page.setViewportSize({ width: 1440, height: 900 });
  // bypass every cache layer
  await page.route("**/*", (route) => route.continue({
    headers: { ...route.request().headers(), "cache-control": "no-cache" },
  }));
  await page.goto("http://localhost:5175/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(400);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2200);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1800);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(2000);
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);

  // dump the ACTUAL rendered tab bar HTML
  const html = await page.evaluate(() => {
    const tb = document.querySelector(".ws-tabbar");
    return {
      tabbarHTML: tb ? tb.outerHTML.replace(/\s+/g, " ").slice(0, 800) : "MISSING",
      tabCount: tb ? tb.children.length : 0,
      sideHTML: document.querySelector(".ws-side")
        ? document.querySelector(".ws-side").outerHTML.slice(0, 200) : "MISSING",
      headHTML: document.querySelector(".ws-head")
        ? document.querySelector(".ws-head").outerHTML.slice(0, 200) : "MISSING",
    };
  });
  await page.screenshot({ path: "D:/AgentHive/qa-truth.png" });
  return html;
}
