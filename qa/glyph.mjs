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

  // measure where the first glyph of line 1 sits in each layer, at scroll 0
  out.atZero = await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    ta.scrollLeft = 0; ta.scrollTop = 0;
    ta.dispatchEvent(new Event("scroll"));
    const preRect = pre.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    // first text node in the pre
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, 1);
    const g = r.getBoundingClientRect();
    return {
      preLeft: preRect.left, taLeft: taRect.left,
      prePadLeft: getComputedStyle(pre).paddingLeft,
      taPadLeft: getComputedStyle(ta).paddingLeft,
      firstGlyphX: g.left,
      glyphOffsetFromPre: g.left - preRect.left,
      glyphOffsetFromTa: g.left - taRect.left,
      transform: pre.style.transform,
    };
  });

  // now scroll and re-measure
  out.atScroll = await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    ta.scrollLeft = 300;
    ta.dispatchEvent(new Event("scroll"));
    const preRect = pre.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, 1);
    const g = r.getBoundingClientRect();
    return {
      scrollLeft: ta.scrollLeft,
      transform: pre.style.transform,
      firstGlyphX: g.left,
      glyphOffsetFromTa: g.left - taRect.left,
      preLeft: preRect.left, taLeft: taRect.left,
    };
  });
  return out;
}
