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
  // closed state clip
  await page.screenshot({
    path: 'D:/AgentHive/qa/ai-closed.png',
    clip: { x: 860, y: 40, width: 260, height: 50 }
  });
  // open state clip
  const btn = page.locator('.ai-split .ghost').first();
  await btn.click({ force: true }).catch(() => btn.evaluate(e => e.click()));
  await page.waitForTimeout(800);
  await page.screenshot({
    path: 'D:/AgentHive/qa/ai-open.png',
    clip: { x: 860, y: 40, width: 260, height: 460 }
  });
  return 'shots taken';
}
