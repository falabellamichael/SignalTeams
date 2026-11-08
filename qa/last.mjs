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

  // Read the DOM and screenshot in one shot, then report both.
  const dom = await page.evaluate(() => {
    const side = document.querySelector(".ws-side");
    const head = document.querySelector(".ws-head");
    const tb = document.querySelector(".ws-tabbar");
    return {
      tabCount: tb ? tb.children.length : 0,
      tabTexts: tb ? [...tb.children].map((e) => e.innerText.replace(/\s+/g, " ").trim()) : [],
      sideX: side ? Math.round(side.getBoundingClientRect().x) : -1,
      sideW: side ? Math.round(side.getBoundingClientRect().width) : 0,
      headX: head ? Math.round(head.getBoundingClientRect().x) : -1,
      headW: head ? Math.round(head.getBoundingClientRect().width) : 0,
      oldBar: !!document.querySelector(".ws-chat-bar"),
      membersW: document.querySelector(".members")
        ? Math.round(document.querySelector(".members").getBoundingClientRect().width) : 0,
    };
  });
  await page.screenshot({ path: "D:/AgentHive/qa-last.png" });
  return dom;
}
