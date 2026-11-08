export default async function run(page, ui) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://localhost:5175/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(400);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2200);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1800);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(2000);

  // open a file
  const row = await page.$('.ws-row');
  if (row) { await row.click(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: "D:/AgentHive/qa-v-file.png" });

  // open chat
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "D:/AgentHive/qa-v-chat.png" });

  return await page.evaluate(() => {
    const r = (s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      vw: innerWidth,
      tabs: [...document.querySelectorAll(".ws-tab")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
      side: r(".ws-side"),
      head: r(".ws-head"),
      chat: r(".ws-chat > .chat"),
      members: r(".members"),
      hasOldBar: !!document.querySelector(".ws-chat-bar"),
    };
  });
}
