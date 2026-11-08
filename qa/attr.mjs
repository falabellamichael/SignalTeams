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
  await page.waitForTimeout(1200);
  return await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    return {
      wrapAttr: ta.getAttribute("wrap"),
      wrapProp: ta.wrap,
      cols: ta.cols,
      scrollW: ta.scrollWidth,
      clientW: ta.clientWidth,
      // measure the first line's rendered height — if it's 2 lines tall, it wrapped
      firstLineH: (() => {
        const r = document.createRange();
        const tn = ta.firstChild;
        r.setStart(tn, 0); r.setEnd(tn, 1);
        return r.getBoundingClientRect().height;
      })(),
      lineHeight: getComputedStyle(ta).lineHeight,
    };
  });
}
