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
  const openDrawer = async () => {
    if (!(await page.$(".side-wrap.open"))) { await page.$eval(".burger", (b) => b.click()); await page.waitForTimeout(500); }
  };

  // server → pick the 🔊 voice channel
  await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click());
  await page.waitForTimeout(1200);
  await openDrawer();
  out.voiceFound = await page.$$eval(".nav-item", (els) => {
    const v = els.find((e) => e.querySelector(".ch-hash")?.textContent.includes("🔊"));
    if (v) { v.click(); return true; } return false;
  });
  await page.waitForTimeout(1500);
  await shot("17-voice");

  // any workspace nav rows?
  await openDrawer();
  out.wsCount = await page.$$eval(".ws-nav", (els) => els.length);
  if (out.wsCount) {
    await page.$$eval(".ws-nav", (els) => els[0].click());
    await page.waitForTimeout(1500);
    await shot("18-workspace");
  }
  return out;
}
