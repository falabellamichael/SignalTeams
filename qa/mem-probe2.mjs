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
  // instrument the grip, then simulate the drag via real mouse
  await page.evaluate(() => {
    window.__dragFired = 0;
    const g = document.querySelector('.members > .side-drag');
    g.addEventListener('mousedown', () => { window.__dragFired++; });
  });
  const gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb.x - 60, gb.y + 300, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return await page.evaluate(() => ({
    fired: window.__dragFired,
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
}
