export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  await page.evaluate(() => localStorage.setItem('st.sidew', '248'));
  await page.reload();
  await page.waitForTimeout(3500);
  const srv2 = page.locator('[title*="Signal HQ"]').first();
  await srv2.click({ force: true }).catch(() => srv2.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  return await page.evaluate(() => {
    const bar = document.querySelector('.me-bar');
    const parts = Array.from(bar.children).map(e => {
      const r = e.getBoundingClientRect();
      return { cls: e.className, w: Math.round(r.width), h: Math.round(r.height) };
    });
    const cs = getComputedStyle(bar);
    const who = bar.querySelector('.who');
    const wcs = getComputedStyle(who);
    const n = bar.querySelector('.who .n');
    const s = bar.querySelector('.who .s');
    return {
      barW: bar.getBoundingClientRect().width,
      barPad: cs.padding, gap: cs.gap,
      parts,
      whoW: who.getBoundingClientRect().width,
      whoMinW: wcs.minWidth, whoFlex: wcs.flex,
      nText: n.textContent, nW: n.getBoundingClientRect().width,
      nScroll: n.scrollWidth, nWhiteSpace: getComputedStyle(n).whiteSpace,
      sText: s.textContent, sW: s.getBoundingClientRect().width,
      sScroll: s.scrollWidth, sWhiteSpace: getComputedStyle(s).whiteSpace,
      sOverflow: getComputedStyle(s).overflow
    };
  });
}
