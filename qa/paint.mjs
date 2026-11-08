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
  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const info = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { missing: true };
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        display: s.display, position: s.position, zIndex: s.zIndex,
        overflow: s.overflow, flex: s.flex, flexDir: s.flexDirection,
        transform: s.transform, opacity: s.opacity, visibility: s.visibility,
      };
    };
    // what is actually painted at the top-left of the chat area?
    const el = document.elementFromPoint(100, 100);
    return {
      app: info(".app"),
      main: info(".main"),
      ws: info(".ws"),
      head: info(".ws-head"),
      body: info(".ws-body"),
      side: info(".ws-side"),
      wsMain: info(".ws-main"),
      tabbar: info(".ws-tabbar"),
      wsChat: info(".ws-chat"),
      chat: info(".ws-chat > .chat"),
      topLeftEl: el ? `${el.tagName}.${el.className}`.slice(0, 80) : null,
      bodyScrollW: document.body.scrollWidth,
      docScrollW: document.documentElement.scrollWidth,
      innerW: innerWidth,
    };
  });
}
