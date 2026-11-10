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
    const g = document.querySelector('.members > .side-drag');
    const m = document.querySelector('.members');
    if (!g) return {
      grip: 'none', members: m ? m.getBoundingClientRect().width : null,
      memCount: document.querySelectorAll('.members').length
    };
    const r = g.getBoundingClientRect();
    return {
      gripRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      memW: m.getBoundingClientRect().width,
      cursor: getComputedStyle(g).cursor
    };
  });
}
