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
  // open a channel with a member list
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2000);
  const members = page.locator('.members').first();
  const count = await members.count();
  if (!count) return { error: 'no member list on this channel' };
  const before = await members.evaluate(e => e.getBoundingClientRect().width);
  // grip is on the LEFT edge of the members panel
  const grip = page.locator('.members > .side-drag').first();
  const gb = await grip.boundingBox();
  // drag left → panel grows (mouse moves left = wider)
  await page.mouse.move(gb.x + 2, gb.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb.x - 100, gb.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const wider = await members.evaluate(e => e.getBoundingClientRect().width);
  // drag right → narrower, clamped at 160
  const gb2 = await grip.boundingBox();
  await page.mouse.move(gb2.x + 2, gb2.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb2.x + 200, gb2.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const narrow = await members.evaluate(e => e.getBoundingClientRect().width);
  const stored = await page.evaluate(() => localStorage.getItem('st.memw'));
  return { before, wider, narrow, stored };
}
