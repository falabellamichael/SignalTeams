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
      const s = getComputedStyle(el);
      return {
        font: s.font, fontFamily: s.fontFamily, fontSize: s.fontSize,
        lineHeight: s.lineHeight, padding: s.padding, letterSpacing: s.letterSpacing,
        whiteSpace: s.whiteSpace, tabSize: s.tabSize, boxSizing: s.boxSizing,
        width: s.width, height: s.height, overflow: s.overflow
      };
    };
    // measure a single character width in each layer
    const probe = (el) => {
      const r = document.createRange();
      const tn = el.firstChild;
      if (!tn) return null;
      r.setStart(tn, 0); r.setEnd(tn, Math.min(10, tn.length));
      const b = r.getBoundingClientRect();
      return { w10: b.width, h: b.height, top: b.top, left: b.left };
    };
    return {
      ta: cs(ta), pre: cs(pre),
      taProbe: probe(ta), preProbe: probe(pre),
      taRect: ta.getBoundingClientRect().toJSON(),
      preRect: pre.getBoundingClientRect().toJSON(),
      preFirstText: pre.textContent.slice(0, 60),
      taFirstText: ta.value.slice(0, 60),
    };
  });
  return out;
}
