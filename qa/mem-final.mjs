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
  // record node identity, attach listener, drag, then check identity + result
  await page.evaluate(() => {
    window.__g0 = document.querySelector('.members > .side-drag');
    window.__fired = 0;
    window.__g0.addEventListener('mousedown', () => window.__fired++);
  });
  const gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x - 80, gb.y + 250, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => ({
    fired: window.__fired,
    sameNode: window.__g0 === document.querySelector('.members > .side-drag'),
    memW: document.querySelector('.members').getBoundingClientRect().width,
    resizingClass: document.body.className
  }));
  // now drag back narrower
  const gb2 = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb2.x + 2, gb2.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb2.x + 120, gb2.y + 250, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => ({
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  await page.screenshot({
    path: 'D:/AgentHive/qa/mem-drag.png',
    clip: { x: 900, y: 0, width: 380, height: 600 }
  });
  return { widen: r1, narrow: r2 };
}
