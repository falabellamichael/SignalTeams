export default async function run(page, ui) {
  const out = {};
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(400); snap = await ui.snapshot(); }
  const boxes = [...snap.matchAll(/@(e\d+) textbox/g)].map((m) => m[1]);
  if (boxes.length >= 2) {
    await ui.fill("@" + boxes[0], "mike"); await ui.fill("@" + boxes[1], "password");
    await ui.click(snap.match(/@(e\d+) button "Sign in"/)?.[1]);
    await page.waitForTimeout(3000);
  }
  const rects = () => page.evaluate(() => {
    const w = document.querySelector(".side-wrap");
    const s = document.querySelector(".side");
    const scrim = document.querySelector(".side-scrim");
    const r = (e) => e ? { x: Math.round(e.getBoundingClientRect().x), w: Math.round(e.getBoundingClientRect().width) } : null;
    return { wrap: r(w), side: r(s), open: w?.className, scrim: !!scrim,
             transform: w ? getComputedStyle(w).transform : null };
  });

  // server → drawer → measure open state
  await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click());
  await page.waitForTimeout(1200);
  await page.$eval(".burger", (b) => b.click());
  await page.waitForTimeout(600);
  out.open = await rects();
  await page.screenshot({ path: "D:/AgentHive/qa/m-19-drawer.png" });

  // click a TEXT channel → drawer should auto-close
  await page.$$eval(".nav-item", (els) => {
    const t = els.find((e) => e.querySelector(".ch-hash")?.textContent.trim() === "#");
    (t || els[0]).click();
  });
  await page.waitForTimeout(900);
  out.afterChannelClick = await rects();
  return out;
}
