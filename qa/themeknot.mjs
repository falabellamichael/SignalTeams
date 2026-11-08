export default async function run(page, ui) {
  const out = { timeline: [] };
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);

  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  await page.click('.nav-item:has-text("agent-drops")').catch(() => {});
  await page.waitForTimeout(1500);

  const box = await page.$('textarea, .composer input[type=text]');
  if (!box) { out.fail = "no composer"; return out; }
  await box.fill("@ragwrangler tell me about distributed consensus");
  await box.press("Enter");

  // wait for the working state
  let saw = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const typing = (await page.$(".typing")) ? await page.$eval(".typing", (e) => e.innerText).catch(() => "") : "";
    if (typing && await page.$(".typknot")) { saw = true; break; }
  }
  if (!saw) { out.fail = "no knot/typing appeared"; return out; }

  // cycle themes while the agent works — knot asset should swap per theme
  for (const t of ["dark", "obsidian", "light", "daylight"]) {
    await page.evaluate((tt) => { document.documentElement.dataset.theme = tt; }, t);
    await page.waitForTimeout(700);
    const src = await page.$eval(".typknot", (e) =>
      getComputedStyle(e).content).catch(() => "?");
    out.timeline.push({ theme: t, content: src.slice(0, 90) });
    await page.screenshot({ path: `D:/AgentHive/qa-knot-${t}.png` });
  }
  return out;
}
