export default async function run(page, ui) {
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1500);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(1800);
  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);

  // freeze the page so nothing can re-render between the query and the shot
  await page.evaluate(() => {
    document.body.style.pointerEvents = "none";
    window.__frozen = true;
  });
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const s = document.querySelector(".ws-side");
    const r = s?.getBoundingClientRect();
    return {
      sideX: r ? Math.round(r.x) : null,
      sideW: r ? Math.round(r.width) : null,
      sideDisplay: s ? getComputedStyle(s).display : "MISSING",
      tabCount: document.querySelectorAll(".ws-tab").length,
      tabTexts: [...document.querySelectorAll(".ws-tab")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
      viewportW: innerWidth,
      dpr: devicePixelRatio,
    };
  });

  await page.screenshot({ path: "D:/AgentHive/qa-proof.png", fullPage: false });
  return state;
}
