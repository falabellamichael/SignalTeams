export default async function run(page, ui) {
  const out = { shots: [] };
  const shot = async (n) => { await page.screenshot({ path: `D:/AgentHive/qa/m-${n}.png` }); out.shots.push("m-" + n); };
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
  const memBtn = async () => !!(await page.$(".mem-btn"));

  // buzz feed (default view)
  await shot("13-buzz");
  out.memOnBuzz = await memBtn();

  // server channel — click second rail icon (first is Home), then first #channel
  await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click());
  await page.waitForTimeout(1200);
  // open sidebar drawer if closed, click first channel nav item
  if (!(await page.$(".side-wrap.open"))) await page.$eval(".burger", (b) => b.click());
  await page.waitForTimeout(500);
  await page.$$eval(".nav-item", (els) => els.find((e) => /#/.test(e.textContent))?.click() || els[0]?.click());
  await page.waitForTimeout(1500);
  await shot("14-channel");
  out.memOnChannel = await memBtn();

  // members drawer via the topbar button
  if (out.memOnChannel) {
    await page.$eval(".mem-btn", (b) => b.click());
    await page.waitForTimeout(700);
    out.memDrawerOpen = !!(await page.$(".members.open")) || !!(await page.$(".mem-panel.open")) || !!(await page.$(".side-wrap.open .members"));
    await shot("15-members");
    // close: tap the mem-btn again
    await page.$eval(".mem-btn", (b) => b.click());
    await page.waitForTimeout(500);
  }

  // back Home, then library — members button should be GONE (bug fix check)
  await page.$$eval(".rail .rail-ico", (els) => els[0]?.click());
  await page.waitForTimeout(1000);
  if (!(await page.$(".side-wrap.open"))) await page.$eval(".burger", (b) => b.click());
  await page.waitForTimeout(500);
  await page.$$eval(".nav-item", (els) => els.find((e) => /Library/.test(e.textContent))?.click());
  await page.waitForTimeout(1400);
  out.memOnLibrary = await memBtn();
  await shot("16-library-fix");

  return out;
}
