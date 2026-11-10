export default async function run(page, ui) {
  const out = { shots: [] };
  const shot = async (n) => { await page.screenshot({ path: `D:/AgentHive/qa/m-${n}.png` }); out.shots.push("m-" + n); };
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
  await page.$$eval(".nav-item .txt", (els) => (els.find((e) => e.textContent.trim() === "general") || els[0]).click());
  await page.waitForTimeout(1500);

  // emoji button in composer
  const emojiBtn = await page.$(".composer [title*='moji'], .composer button[title*='emoji']");
  out.emojiBtn = !!emojiBtn;
  if (emojiBtn) {
    await emojiBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    out.emojiPanel = await page.evaluate(() => {
      const el = document.querySelector(".emoji-pick, [class*='emoji']");
      return el ? el.className : null;
    });
    await shot("25-emoji");
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  }

  // composer input font-size (iOS zoom check) + typing
  out.inputFont = await page.evaluate(() => {
    const ta = document.querySelector(".composer textarea, .composer input");
    return ta ? getComputedStyle(ta).fontSize : null;
  });
  const ta = await page.$(".composer textarea");
  if (ta) { await ta.type("hi from mobile", { delay: 8 }); await shot("26-typing"); }

  // summon (@) button
  const summonBtn = await page.$(".composer [title*='summon'], .composer [title*='Summon'], .composer [title*='agent']");
  out.summonBtn = !!summonBtn;
  if (summonBtn) {
    await summonBtn.click().catch(() => {});
    await page.waitForTimeout(700);
    out.summonPanel = await page.evaluate(() => {
      const el = document.querySelector(".at-menu, .mention-menu, [class*='summon'], .autocomplete");
      return el ? el.className : null;
    });
    await shot("27-summon");
  }
  return out;
}
