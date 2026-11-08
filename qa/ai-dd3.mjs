export default async function run(page) {
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
  const btn = page.locator('.ai-split .ghost').first();
  await btn.click({ force: true }).catch(() => btn.evaluate(e => e.click()));
  await page.waitForTimeout(600);
  // get the panel's bounding box and screenshot a region around it
  const box = await page.locator('.ai-panel').boundingBox();
  const out = { box };
  if (box) {
    await page.screenshot({
      path: 'D:/AgentHive/qa/ai-dd3.png',
      clip: {
        x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 60),
        width: box.width + 120, height: box.height + 120
      }
    });
  } else {
    await page.screenshot({ path: 'D:/AgentHive/qa/ai-dd3.png' });
  }
  // also record the caret button's on state
  out.btnOn = await page.locator('.ai-split .ghost.on').count();
  return out;
}
