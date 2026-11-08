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
    const cs = (el) => {
      const s = getComputedStyle(el); return {
        padding: s.padding, boxSizing: s.boxSizing, width: s.width,
        font: s.font, lineHeight: s.lineHeight, whiteSpace: s.whiteSpace
      };
    };
    // measure the widest line in the pre
    const lines = pre.textContent.split("\n");
    let widest = 0, widestLine = "";
    const span = document.createElement("span");
    span.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${getComputedStyle(pre).font}`;
    document.body.appendChild(span);
    for (const l of lines) { span.textContent = l; if (span.offsetWidth > widest) { widest = span.offsetWidth; widestLine = l; } }
    span.remove();
    return {
      ta: cs(ta), pre: cs(pre),
      taScrollW: ta.scrollWidth, taClientW: ta.clientWidth, taOffsetW: ta.offsetWidth,
      preScrollW: pre.scrollWidth, preOffsetW: pre.offsetWidth,
      widestTextPx: widest, widestLine: widestLine.slice(0, 50),
      taPadding: getComputedStyle(ta).paddingLeft,
      prePadding: getComputedStyle(pre).paddingLeft,
    };
  });
  return out;
}
