export default async function run(page, ui) {
  await page.setViewportSize({ width: 1440, height: 900 });
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

  return await page.evaluate(() => {
    const side = document.querySelector(".ws-side");
    const chain = [];
    let el = side;
    while (el && el !== document.documentElement) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      chain.push({
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 50),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        display: s.display, position: s.position,
        transform: s.transform === "none" ? "-" : s.transform,
        overflow: s.overflow,
        flex: s.flex,
      });
      el = el.parentElement;
    }
    return { chain, sideRect: side?.getBoundingClientRect().toJSON() };
  });
}
