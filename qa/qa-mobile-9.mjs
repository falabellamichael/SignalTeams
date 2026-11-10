export default async function run(page, ui) {
  const out = {};
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://localhost:8075/?cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
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
  await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click());
  await page.waitForTimeout(1200);
  if (!(await page.$(".side-wrap.open"))) await page.$eval(".burger", (b) => b.click());
  await page.waitForTimeout(500);
  // wait for the server sidebar (Events row = server sidebar, not home)
  await page.waitForSelector(".nav-item .txt", { timeout: 8000 }).catch(() => {});
  await page.$$eval(".nav-item", (els) => {
    const t = els.find((e) => e.querySelector(".txt")?.textContent.trim() === "general");
    (t || els.find((e) => e.querySelector(".ch-hash")?.textContent.trim() === "#") || els[1]).click();
  });
  await page.waitForTimeout(1500);

  // tap an author name → user popout
  out.authorClicked = await page.$$eval(".msg .meta .author", (els) => {
    const el = els.find((e) => !/BOT/.test(e.parentElement.textContent));
    if (el) { el.click(); return true; } return false;
  });
  await page.waitForTimeout(1000);
  out.popout = await page.evaluate(() => {
    const el = document.querySelector(".user-pop");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), x: Math.round(r.x), right: Math.round(r.right),
             inViewport: r.right <= window.innerWidth && r.bottom <= window.innerHeight };
  });
  await page.screenshot({ path: "D:/AgentHive/qa/m-22-popout.png" });
  return out;
}
