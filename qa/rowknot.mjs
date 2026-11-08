export default async function run(page, ui) {
  const out = { timeline: [] };
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

  // login — Supabase box, use the crew account tab
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);

  // server → agent-drops channel
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  const row = await page.$('.nav-item:has-text("agent-drops")');
  if (!row) { out.fail = "no agent-drops row"; return out; }
  await row.click();
  await page.waitForTimeout(1500);

  // summon — we only need the working state, not the finished reply
  const box = await page.$('textarea, .composer input[type=text]');
  if (!box) { out.fail = "no composer"; return out; }
  await box.fill("@ragwrangler what is the capital of france?");
  await box.press("Enter");

  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(1500);
    const snap = {
      t: (i + 1) * 1.5,
      typing: (await page.$(".typing")) ? await page.$eval(".typing", (e) => e.innerText).catch(() => "") : "",
      knotRow: !!(await page.$(".ch-knot")),
      knotTitle: (await page.$(".ch-knot")) ? await page.$eval(".ch-knot", (e) => e.title).catch(() => "") : "",
    };
    out.timeline.push(snap);
    if (snap.knotRow && !out.shot) {
      await page.screenshot({ path: "D:/AgentHive/qa-rowknot.png" });
      out.shot = true;
      out.knotSeen = true;
    }
    if (out.shot && i > 3) break;
  }
  return out;
}
