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
    const chats = [...document.querySelectorAll(".chat")].map((el, i) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      // walk up to find the nearest identifiable ancestor
      let anc = el.parentElement, path = [];
      for (let k = 0; k < 6 && anc; k++) {
        path.push(anc.className?.toString().split(" ")[0] || anc.tagName);
        anc = anc.parentElement;
      }
      return {
        i,
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        display: s.display, vis: s.visibility, opacity: s.opacity,
        ancestors: path.join(" < "),
        firstMsg: el.querySelector(".msgs")?.innerText.slice(0, 40),
      };
    });
    return { count: chats.length, chats };
  });
}
