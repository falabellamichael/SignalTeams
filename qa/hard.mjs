export default async function run(page, ui) {
  await page.setViewportSize({ width: 1440, height: 900 });

  // nuke every cache + service worker, then reload from scratch
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.clearBrowserCache");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });

  await page.goto("http://localhost:5175/", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(400);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2500);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(2000);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(2500);
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3500);

  const dom = await page.evaluate(() => {
    const tb = document.querySelector(".ws-tabbar");
    const side = document.querySelector(".ws-side");
    return {
      tabCount: tb ? tb.children.length : 0,
      tabTexts: tb ? [...tb.children].map((e) => e.innerText.replace(/\s+/g, " ").trim()) : [],
      sideX: side ? Math.round(side.getBoundingClientRect().x) : -1,
      sideW: side ? Math.round(side.getBoundingClientRect().width) : 0,
      oldBar: !!document.querySelector(".ws-chat-bar"),
      head: !!document.querySelector(".ws-head"),
      membersW: document.querySelector(".members")
        ? Math.round(document.querySelector(".members").getBoundingClientRect().width) : 0,
    };
  });
  await page.screenshot({ path: "D:/AgentHive/qa-hard.png" });
  return dom;
}
