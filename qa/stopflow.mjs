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
  await box.fill("@ragwrangler write me a long essay about the history of computing");
  await box.press("Enter");

  // wait for the working state (knot + typing + stop button)
  let sawWorking = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const typing = (await page.$(".typing")) ? await page.$eval(".typing", (e) => e.innerText).catch(() => "") : "";
    const stop = !!(await page.$(".ty-stop"));
    out.timeline.push({ t: i + 1, typing, stop });
    if (stop && typing) { sawWorking = true; break; }
  }
  if (!sawWorking) { out.fail = "never saw working state"; return out; }

  await page.click(".ty-stop");
  out.clickedStop = true;

  // now poll for the finalized stopped reply + cleared typing
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(1000);
    const typing = (await page.$(".typing")) ? await page.$eval(".typing", (e) => e.innerText).catch(() => "") : "";
    const last = await page.$$eval(".msg", (els) =>
      els.slice(-1)[0]?.innerText?.slice(0, 300)).catch(() => "");
    out.timeline.push({ post: i + 1, typing, last: last.slice(0, 140) });
    if (!typing && /stopped|offline/.test(last)) { out.stopped = true; break; }
    if (!typing && last.length > 30) { out.completed = true; break; }
  }
  await page.screenshot({ path: "D:/AgentHive/qa-stop.png" });
  return out;
}
