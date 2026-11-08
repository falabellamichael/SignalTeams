export default async function run(page, ui) {
  const out = {};
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
  const py = await page.$('.ws-row:has-text("workspace.py")');
  await py.click();
  await page.waitForTimeout(1200);

  out.metrics = await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    return {
      taScrollW: ta.scrollWidth, taClientW: ta.clientWidth,
      preScrollW: pre.scrollWidth, preClientW: pre.clientWidth,
      preWidth: getComputedStyle(pre).width,
      canScrollX: ta.scrollWidth > ta.clientWidth,
    };
  });

  // scroll right and check the pre follows
  await page.evaluate(() => { document.querySelector('.ce-ta').scrollLeft = 300; });
  await page.waitForTimeout(300);
  out.afterScroll = await page.evaluate(() => ({
    taLeft: document.querySelector('.ce-ta').scrollLeft,
    preTransform: document.querySelector('.ce-pre').style.transform,
  }));
  await page.screenshot({ path: "D:/AgentHive/qa-ed-scrolled.png" });
  return out;
}
