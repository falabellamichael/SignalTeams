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
  const py = await page.$('.ws-row:has-text("helpers.py")');
  await py.click();
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    const lh = parseFloat(getComputedStyle(ta).lineHeight);
    const src = ta.value.split("\n");
    // Measure the rendered height of the FIRST source line inside the textarea
    // by comparing the y of char 0 and the y of the first char of line 2.
    const tn = ta.firstChild;
    const line1Len = src[0].length;
    const r1 = document.createRange(); r1.setStart(tn, 0); r1.setEnd(tn, 1);
    const r2 = document.createRange(); r2.setStart(tn, line1Len + 1); r2.setEnd(tn, line1Len + 2);
    const y1 = r1.getBoundingClientRect().top;
    const y2 = r2.getBoundingClientRect().top;
    return {
      lineHeight: lh,
      line1: src[0].slice(0, 60),
      line1Len,
      y1, y2,
      gapPx: y2 - y1,
      // if the gap is ~1 line, no wrap; if ~2 lines, line 1 wrapped
      line1Wrapped: (y2 - y1) > lh * 1.5,
      taScrollW: ta.scrollWidth, taClientW: ta.clientWidth,
      taScrollH: ta.scrollHeight,
      preH: pre.getBoundingClientRect().height,
      srcLines: src.length,
      taVisualLines: Math.round(ta.scrollHeight / lh),
      preVisualLines: Math.round(pre.getBoundingClientRect().height / lh),
      wrapAttr: ta.getAttribute("wrap"),
      ws: getComputedStyle(ta).whiteSpace,
    };
  });
}
