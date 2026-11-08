export default async function run(page, ui) {
  const out = {};
  // hard reload so nothing is cached
  await page.goto("http://localhost:5175/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2000);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1800);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(2000);

  // open a file first so we can see the tree working
  const py = await page.$('.ws-row');
  if (py) { await py.click(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: "D:/AgentHive/qa-fresh-file.png" });

  // now open chat
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "D:/AgentHive/qa-fresh-chat.png" });

  out.final = await page.evaluate(() => {
    const tb = document.querySelector(".ws-tabbar");
    const side = document.querySelector(".ws-side");
    return {
      tabs: [...(tb?.children || [])].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
      sideW: side ? Math.round(side.getBoundingClientRect().width) : 0,
      sideVisible: side ? getComputedStyle(side).display !== "none" : false,
      membersW: document.querySelector(".members")
        ? Math.round(document.querySelector(".members").getBoundingClientRect().width) : 0,
      headVisible: !!document.querySelector(".ws-head"),
    };
  });
  return out;
}
