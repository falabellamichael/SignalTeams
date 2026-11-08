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
    const count = (sel) => document.querySelectorAll(sel).length;
    const all = (sel) => [...document.querySelectorAll(sel)].map((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
        h: Math.round(r.height), display: s.display, vis: s.visibility
      };
    });
    return {
      ws: count(".ws"),
      wsBody: count(".ws-body"),
      wsSide: count(".ws-side"),
      wsHead: count(".ws-head"),
      tabbar: count(".ws-tabbar"),
      wsChat: count(".ws-chat"),
      chat: count(".chat"),
      oldBar: count(".ws-chat-bar"),
      app: count(".app"),
      // where each one actually is
      wsRects: all(".ws"),
      sideRects: all(".ws-side"),
      headRects: all(".ws-head"),
      tabbarRects: all(".ws-tabbar"),
      oldBarRects: all(".ws-chat-bar"),
    };
  });
}
