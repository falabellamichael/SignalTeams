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
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    const b = document.querySelector('.ai-split button');
    const r = b.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let e = top;
    while (e && chain.length < 6) { chain.push(e.tagName + '.' + (e.className || '')); e = e.parentElement; }
    // compare with a working neighbor (search button)
    const s = document.querySelector('.ch-tools .ghost');
    const rs = s.getBoundingClientRect();
    const topS = document.elementFromPoint(rs.x + rs.width / 2, rs.y + rs.height / 2);
    return {
      btnCenter: { cx, cy }, topAtBtn: chain,
      topAtSearch: topS ? topS.tagName + '.' + topS.className : 'none',
      viewport: { w: innerWidth, h: innerHeight }
    };
  });
}
