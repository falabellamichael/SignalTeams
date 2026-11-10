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
    const r = g.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + 300;
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let e = top;
    while (e && chain.length < 8) { chain.push(e.tagName + '.' + (e.className || '').toString().slice(0, 40)); e = e.parentElement; }
    return { at: { cx, cy }, chain };
  });
}
