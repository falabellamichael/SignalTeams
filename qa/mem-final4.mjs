export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4500);
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(3000);
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  // current width is 280 from the last run; drag grip 300px right → should clamp at 160
  const gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x + 300, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const clamped = await page.evaluate(() =>
  ({
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  // drag back left to a mid width for the screenshot
  const gb2 = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb2.x + 2, gb2.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb2.x - 60, gb2.y + 250, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/AgentHive/qa/mem-drag.png' });
  return { clamped };
}
