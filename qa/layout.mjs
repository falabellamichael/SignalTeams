export default async function run(page, ui) {
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
  await page.click('.ws-tab-add');
  await page.waitForTimeout(2500);

  return await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
        display: s.display, flex: s.flex, pos: s.position, vis: s.visibility
      };
    };
    return {
      viewport: { w: innerWidth, h: innerHeight },
      app: box(".app"),
      ws: box(".ws"),
      body: box(".ws-body"),
      side: box(".ws-side"),
      main: box(".ws-main"),
      tabbar: box(".ws-tabbar"),
      wsChat: box(".ws-chat"),
      chat: box(".ws-chat > .chat"),
      members: box(".members"),
      // is the side actually painted?
      sideVisible: (() => {
        const el = document.querySelector(".ws-side");
        if (!el) return "missing";
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? "visible" : "zero-size";
      })(),
      tabbarChildren: [...(document.querySelector(".ws-tabbar")?.children || [])]
        .map((e) => ({ cls: e.className, txt: e.innerText.replace(/\s+/g, " ").trim() })),
    };
  });
}
