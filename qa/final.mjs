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
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "D:/AgentHive/qa-ed-final.png" });

  // scroll right 200px and screenshot
  await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    ta.scrollLeft = 200;
    ta.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "D:/AgentHive/qa-ed-final-scrolled.png" });

  // verify alignment: compare the first visible glyph x in both layers
  out.align = await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    const taRect = ta.getBoundingClientRect();
    const preRect = pre.getBoundingClientRect();
    // find the first text node in the pre and measure its x
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, 1);
    const g = r.getBoundingClientRect();
    return {
      scrollLeft: ta.scrollLeft,
      preTransform: pre.style.transform,
      glyphX: g.left,
      taLeft: taRect.left,
      preLeft: preRect.left,
      glyphOffsetFromTa: g.left - taRect.left,
    };
  });
  return out;
}
