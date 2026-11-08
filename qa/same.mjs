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
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);

  // freeze everything so the screenshot and the DOM are the same frame
  await page.evaluate(() => {
    document.querySelectorAll("*").forEach((el) => {
      el.style.animation = "none";
      el.style.transition = "none";
    });
  });
  await page.waitForTimeout(800);

  const before = await page.evaluate(() => ({
    tabs: document.querySelectorAll(".ws-tab").length,
    side: !!document.querySelector(".ws-side"),
    sideX: Math.round(document.querySelector(".ws-side")?.getBoundingClientRect().x || -1),
    head: !!document.querySelector(".ws-head"),
    oldBar: !!document.querySelector(".ws-chat-bar"),
  }));

  await page.screenshot({ path: "D:/AgentHive/qa-same.png" });

  const after = await page.evaluate(() => ({
    tabs: document.querySelectorAll(".ws-tab").length,
    side: !!document.querySelector(".ws-side"),
    sideX: Math.round(document.querySelector(".ws-side")?.getBoundingClientRect().x || -1),
    head: !!document.querySelector(".ws-head"),
    oldBar: !!document.querySelector(".ws-chat-bar"),
  }));

  return { before, after, same: JSON.stringify(before) === JSON.stringify(after) };
}
