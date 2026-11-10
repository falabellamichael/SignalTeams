export default async function run(page, ui) {
  const out = { shots: [] };
  const shot = async (n) => { await page.screenshot({ path: `D:/AgentHive/qa/clip-${n}.png` }); out.shots.push("clip-" + n); };
  const login = async () => {
    await page.goto(`http://192.168.2.11:8075/?cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
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
  };
  const state = () => page.evaluate(() => {
    const w = document.querySelector(".side-wrap");
    const m = document.querySelector(".members");
    const r = (e) => e ? Math.round(e.getBoundingClientRect().x) + "x" + Math.round(e.getBoundingClientRect().width) : null;
    return { vw: window.innerWidth, wrap: r(w), wrapCls: w?.className, members: r(m), rail: r(document.querySelector(".rail")) };
  });

  for (const vp of [{ w: 360, h: 800 }, { w: 390, h: 844 }, { w: 844, h: 390 }, { w: 800, h: 1280 }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await login();
    await shot(`${vp.w}x${vp.h}`);
    out[`${vp.w}`] = await state();
    // open a channel too — main chat surface
    await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click()).catch(() => {});
    await page.waitForTimeout(1100);
    await shot(`${vp.w}x${vp.h}-server`);
    out[`${vp.w}-server`] = await state();
  }
  return out;
}
