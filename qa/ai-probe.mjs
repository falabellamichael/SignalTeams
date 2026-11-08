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
    const s = document.querySelector('.ai-split');
    if (!s) return 'no ai-split';
    const b = s.querySelector('button');
    const cs = getComputedStyle(b);
    const svgs = s.querySelectorAll('svg');
    const svgInfo = Array.from(svgs).map(v => {
      const r = v.getBoundingClientRect();
      const c = getComputedStyle(v);
      return {
        w: r.width, h: r.height, color: c.color, fill: c.fill,
        display: c.display, opacity: c.opacity,
        inner: v.querySelector('path') ? 'has path' : 'NO PATH'
      };
    });
    const r = s.getBoundingClientRect();
    return {
      splitRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      btnColor: cs.color, btnBg: cs.backgroundColor,
      btnOpacity: cs.opacity, btnDisplay: cs.display,
      btnFontSize: cs.fontSize, btnLineHeight: cs.lineHeight,
      svgs: svgInfo,
      parentOverflow: getComputedStyle(s.parentElement).overflow,
      parentW: s.parentElement.getBoundingClientRect().width
    };
  });
}
