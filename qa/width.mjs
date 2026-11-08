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
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        display: s.display, flex: s.flex, flexDir: s.flexDirection,
        minW: s.minWidth, width: s.width, overflow: s.overflow
      };
    };
    return {
      ws: pick(".ws"),
      body: pick(".ws-body"),
      main: pick(".ws-main"),
      wsChat: pick(".ws-chat"),
      chat: pick(".ws-chat > .chat"),
      core: pick(".chat-core"),
      msgs: pick(".msgs"),
      members: pick(".members"),
      bodyClass: document.querySelector(".ws-body")?.className,
    };
  });
}
