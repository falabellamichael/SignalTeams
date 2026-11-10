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
  // into a server channel
  await page.$$eval(".rail-ico", (els) => els[1]?.click());
  await page.waitForTimeout(1000);
  await page.$$eval(".nav-item", (els) => { const t = els.find((e) => /#/.test(e.textContent)); (t || els[0]).click(); });
  await page.waitForTimeout(1500);

  // members drawer → close via scrim edge (left side, away from the drawer)
  snap = await ui.snapshot();
  const memBtn = snap.match(/@(e\d+) button "Members"/)?.[1];
  if (memBtn) await ui.click(memBtn);
  await page.waitForTimeout(500);
  out.drawerOpen = !!(await page.$(".members.open"));
  await page.mouse.click(12, 400);           // scrim's exposed left strip
  await page.waitForTimeout(400);
  out.drawerClosed = !(await page.$(".members.open"));

  // long-press a message → context menu
  const lp = await page.evaluate(() => {
    const el = document.querySelector(".msg:not(.grouped)") || document.querySelector(".msg");
    if (!el) return "no-msg";
    const r = el.getBoundingClientRect();
    const x = Math.min(r.left + 120, r.right - 10), y = r.top + Math.min(14, r.height - 4);
    const mk = (type) => new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
    });
    el.dispatchEvent(mk("touchstart"));
    return new Promise((res) => setTimeout(() => { el.dispatchEvent(mk("touchend")); res("ok"); }, 650));
  });
  out.lp = lp;
  await page.waitForTimeout(400);
  out.menuOpen = !!(await page.$(".msg-menu"));
  await page.screenshot({ path: "D:/AgentHive/qa/m-8-msgmenu.png" });
  return out;
}
