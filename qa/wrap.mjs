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

  out.m = await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    const hl = document.querySelector('.ce-hl');
    const cs = (el) => {
      const s = getComputedStyle(el); return {
        width: s.width, whiteSpace: s.whiteSpace, overflow: s.overflow,
        overflowX: s.overflowX, position: s.position, left: s.left,
        padding: s.padding, boxSizing: s.boxSizing, display: s.display
      };
    };
    // count rendered line boxes in the pre by measuring its height
    const preH = pre.getBoundingClientRect().height;
    const lh = parseFloat(getComputedStyle(pre).lineHeight);
    return {
      ta: cs(ta), pre: cs(pre), hl: cs(hl),
      preHeight: preH, lineHeight: lh,
      preRenderedLines: Math.round(preH / lh),
      sourceLines: ta.value.split("\n").length,
      preScrollW: pre.scrollWidth, preOffsetW: pre.offsetWidth,
      taScrollW: ta.scrollWidth, taClientW: ta.clientWidth,
      preTextLen: pre.textContent.length, taTextLen: ta.value.length,
    };
  });
  return out;
}
