export default async function run(page, ui) {
  const out = { timeline: [] };
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

  const snap = async (tag) => out.timeline.push({
    tag,
    typing: (await page.$(".typing")) ? (await page.$eval(".typing", (e) => e.innerText).catch(() => "")) : "",
    knot: !!(await page.$(".typing .typknot")),
    lastMsg: (await page.$$eval(".ws-chat .msg", (els) =>
      els.slice(-1)[0]?.innerText?.slice(0, 160)).catch(() => "")),
  });

  // login — Supabase box, use the crew account tab
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);

  // server → workspace → chat tab
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  const wsRow = await page.$('.ws-nav');
  if (!wsRow) { out.fail = "no workspace nav row"; return out; }
  await wsRow.click();
  await page.waitForTimeout(1800);
  await page.click('.ws-tab-add').catch(() => {});
  await page.waitForTimeout(2500);
  out.chatMounted = !!(await page.$('.ws-chat > .chat'));

  // summon an agent with a workspace question (forces the tool loop)
  const box = await page.$('.ws-chat textarea, .ws-chat input[type=text]');
  if (!box) { out.fail = "no composer"; return out; }
  await box.fill("@ragwrangler what files are at the workspace root?");
  await box.press("Enter");
  await snap("sent");

  // poll while the reply streams — catch phases + elapsed + knot
  let shots = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    await snap(`t${(i + 1) * 1.5}s`);
    const cur = out.timeline[out.timeline.length - 1];
    if (cur.knot && shots === 0) {
      await page.screenshot({ path: "D:/AgentHive/qa-ind-working.png" });
      shots++;
    }
    if (/running|thinking/.test(cur.typing) && shots < 2) {
      await page.screenshot({ path: "D:/AgentHive/qa-ind-phase.png" });
      shots++;
    }
    if (cur.lastMsg && !/▌|…$/.test(cur.lastMsg) && cur.lastMsg.length > 40 && !cur.knot) break;
  }
  await page.screenshot({ path: "D:/AgentHive/qa-ind-final.png" });
  return out;
}
