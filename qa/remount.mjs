export default async function run(page, ui) {
  const out = { renders: [] };
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

  // instrument: watch .ws-side for removal
  await page.evaluate(() => {
    window.__sideLog = [];
    const obs = new MutationObserver(() => {
      const s = document.querySelector(".ws-side");
      window.__sideLog.push({
        t: Date.now(),
        side: s ? getComputedStyle(s).display : "MISSING",
        bodyCls: document.querySelector(".ws-body")?.className,
        tabs: document.querySelectorAll(".ws-tab").length,
      });
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
  });

  await page.click('.ws-tab-add');
  await page.waitForTimeout(3000);

  out.log = await page.evaluate(() => window.__sideLog.slice(-25));
  out.final = await page.evaluate(() => {
    const s = document.querySelector(".ws-side");
    return {
      side: s ? getComputedStyle(s).display : "MISSING",
      sideW: s ? Math.round(s.getBoundingClientRect().width) : 0,
      bodyCls: document.querySelector(".ws-body")?.className,
      tabs: [...document.querySelectorAll(".ws-tab")].map((e) => e.innerText.replace(/\s+/g, " ").trim()),
    };
  });
  return out;
}
