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
  await page.waitForTimeout(800);
  // computed style of the panel — is it actually visible/painted?
  const info = await page.evaluate(() => {
    const p = document.querySelector('.ai-panel');
    if (!p) return { gone: true };
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return {
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      z: cs.zIndex, bg: cs.backgroundColor, overflow: cs.overflow
    };
  });
  await page.screenshot({ path: 'D:/AgentHive/qa/ai-dd4.png' });
  return info;
}
