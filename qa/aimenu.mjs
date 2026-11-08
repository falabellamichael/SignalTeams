export default async function run(page, ui) {
  const out = {};
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

  // login — Supabase box, use the crew account tab
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2000);

  // enter the server, then open #general (web+vision set via API earlier)
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  const ch = await page.$('.nav-item:has-text("general")');
  if (!ch) {
    const snap = await ui.snapshot();
    out.fail = "no general channel row"; out.snap = snap.slice(0, 1500); return out;
  }
  await ch.click();
  await page.waitForTimeout(1200);

  // open the AI dropdown (sparkle button in ch-tools)
  const aiBtn = await page.$('.ai-split button');
  if (!aiBtn) { out.fail = "no AI button"; return out; }
  await aiBtn.click();
  await page.waitForTimeout(400);
  out.panelOpen = !!(await page.$('.ai-panel'));
  await page.screenshot({ path: "qa/ai-panel.png" });

  // icons must be real svg glyphs, not emoji text
  out.items = await page.$$eval(".ai-item", (els) => els.map((el) => ({
    label: el.querySelector(".ai-txt b")?.innerText,
    on: el.classList.contains("on"),
    svg: !!el.querySelector(".ai-ico svg"),
    emojiText: el.querySelector(".ai-ico")?.innerText?.trim() || "",
  })));

  // server-truth state should show web+vision already on (set via PATCH)
  // toggle STT on → mic button should appear in the composer
  const sttRow = await page.$('.ai-item:has-text("Speech to text")');
  await sttRow?.click();
  await page.waitForTimeout(1200);   // PATCH + server broadcast round-trip

  out.micBtn = !!(await page.$(".cbtn.mic"));
  out.sttOn = await page.$eval('.ai-item:has-text("Speech to text")',
    (el) => el.classList.contains("on")).catch(() => null);

  // persistence — reload and check the toggle survives via channel.ai
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  const ch2 = await page.$('.nav-item:has-text("general")');
  await ch2?.click();
  await page.waitForTimeout(1200);
  const aiBtn2 = await page.$('.ai-split button');
  await aiBtn2?.click();
  await page.waitForTimeout(400);
  out.afterReload = await page.$$eval(".ai-item", (els) => els.map((el) => ({
    label: el.querySelector(".ai-txt b")?.innerText,
    on: el.classList.contains("on"),
  })));
  out.micAfterReload = !!(await page.$(".cbtn.mic"));
  await page.screenshot({ path: "qa/ai-panel2.png" });
  return out;
}
