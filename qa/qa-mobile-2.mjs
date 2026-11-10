export default async function run(page, ui) {
  const out = {};
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);

  // login (crew)
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(400); snap = await ui.snapshot(); }
  const boxes = [...snap.matchAll(/@(e\d+) textbox/g)].map((m) => m[1]);
  if (boxes.length >= 2) {
    await ui.fill("@" + boxes[0], "mike"); await ui.fill("@" + boxes[1], "password");
    await ui.click(snap.match(/@(e\d+) button "Sign in"/)?.[1]);
    await page.waitForTimeout(3000);
  }

  // open the drawer, click a server icon (rail), then a channel
  snap = await ui.snapshot();
  const burger = snap.match(/@(e\d+) button "Menu"/)?.[1];
  if (burger) await ui.click(burger);
  await page.waitForTimeout(400);
  // server icons are .rail-ico buttons in the far-left rail
  const srv = await page.$$eval(".rail-ico", (els) =>
    els.map((b) => b.getAttribute("title") || b.textContent.trim()));
  out.servers = srv;
  if (srv.length > 1) {
    await page.$$eval(".rail-ico", (els) => els[1].click());
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: "D:/AgentHive/qa/m-5-server.png" });
  // pick first text channel
  const chan = await page.$$eval(".nav-item", (els) => els.length);
  out.navItems = chan;
  await page.$$eval(".nav-item", (els) => {
    const t = els.find((e) => /#/.test(e.textContent)); (t || els[0]).click();
  });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: "D:/AgentHive/qa/m-6-channel.png" }); out.shots = ["m-5-server", "m-6-channel"];

  // members drawer via the new topbar button
  snap = await ui.snapshot();
  const memBtn = snap.match(/@(e\d+) button "Members"/)?.[1];
  out.memBtn = !!memBtn;
  if (memBtn) {
    await ui.click(memBtn); await page.waitForTimeout(500);
    await page.screenshot({ path: "D:/AgentHive/qa/m-7-members.png" }); out.shots.push("m-7-members");
    // close it
    const scrim = await page.$(".mem-scrim");
    if (scrim) await scrim.click(); await page.waitForTimeout(400);
  }

  // long-press a message → context menu
  const fired = await page.evaluate(() => {
    const el = document.querySelector(".msg:not(.grouped)") || document.querySelector(".msg");
    if (!el) return "no-msg";
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height - 4, 12);
    const mk = (type) => new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
    });
    el.dispatchEvent(mk("touchstart"));
    return new Promise((res) => setTimeout(() => { el.dispatchEvent(mk("touchend")); res("fired"); }, 600));
  });
  out.longPress = fired;
  await page.waitForTimeout(400);
  out.menuOpen = !!(await page.$(".msg-menu"));
  await page.screenshot({ path: "D:/AgentHive/qa/m-8-msgmenu.png" }); out.shots.push("m-8-msgmenu");
  return out;
}
