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
  const py = await page.$('.ws-row:has-text("workspace.py")');
  await py.click();
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    const s = getComputedStyle(ta);
    // measure the height of the first source line as rendered in the textarea
    const tn = ta.firstChild;
    const r = document.createRange();
    r.setStart(tn, 0);
    r.setEnd(tn, 1);
    const g = r.getBoundingClientRect();
    return {
      wrapAttr: ta.getAttribute("wrap"),
      whiteSpace: s.whiteSpace,
      textWrap: s.textWrap,
      overflowX: s.overflowX,
      width: s.width,
      scrollWidth: ta.scrollWidth,
      clientWidth: ta.clientWidth,
      lineHeight: s.lineHeight,
      firstGlyphHeight: g.height,
      // if the first glyph's box is taller than one line, the text wrapped
      wrapped: g.height > parseFloat(s.lineHeight) * 1.5,
      preWhiteSpace: getComputedStyle(pre).whiteSpace,
      preWidth: pre.getBoundingClientRect().width,
      preScrollWidth: pre.scrollWidth,
    };
  });
}
