export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4500);
  const bc = (await page.locator('body').innerText()).length;
  if (bc < 2000) return { error: 'login flake', bc };
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(3000);
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x + 300, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  return await page.evaluate(() =>
  ({
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
}
