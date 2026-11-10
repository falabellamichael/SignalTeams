export default async function run(page, ui) {
  const out = { shots: [] };
  const shot = async (n) => { await page.screenshot({ path: `D:/AgentHive/qa/m-${n}.png` }); out.shots.push("m-" + n); };
  await page.setViewportSize({ width: 390, height: 844 });
  // cache-busted nav so index.html revalidates → fresh chunk names
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

  // server → #general
  await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click());
  await page.waitForTimeout(1200);
  if (!(await page.$(".side-wrap.open"))) await page.$eval(".burger", (b) => b.click());
  await page.waitForTimeout(500);
  await page.$$eval(".nav-item", (els) => {
    const t = els.find((e) => /general/.test(e.textContent));
    (t || els[1]).click();
  });
  await page.waitForTimeout(1500);

  // long-press a message → .msg-menu (real TouchEvent dispatch)
  out.lp = await page.evaluate(() => {
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
  await page.waitForTimeout(400);
  out.menuOpen = !!(await page.$(".msg-menu"));
  if (out.menuOpen) {
    out.menuItems = await page.$$eval(".msg-menu *", (els) =>
      els.filter((e) => e.children.length === 0).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 14));
    // thread option?
    out.threadPicked = await page.$$eval(".msg-menu *", (els) => {
      const t = els.find((e) => /thread/i.test(e.textContent) && e.children.length < 3);
      if (t) { t.click(); return t.textContent.trim(); } return null;
    });
    await page.waitForTimeout(900);
    out.threadPanel = !!(await page.$(".thread-panel"));
    await shot("20-thread");
  }

  // tap an avatar → user popout
  await page.keyboard.press("Escape").catch(() => {});
  const av = await page.$(".msg .av");
  if (av) { await av.click().catch(() => {}); await page.waitForTimeout(700); }
  out.popout = await page.evaluate(() => {
    const el = document.querySelector(".user-pop, .upop, .popout, [class*='userpop']");
    return el ? el.className : false;
  });
  await shot("21-popout");
  return out;
}
