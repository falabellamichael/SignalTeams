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
  // inspect each toolbar child: rect + inner svg count
  const kids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ch-tools > *')).map(e => {
      const r = e.getBoundingClientRect();
      return {
        cls: e.className, x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        svgs: e.querySelectorAll('svg').length,
        html: e.outerHTML.slice(0, 120)
      };
    }));
  // element screenshot of the whole toolbar with the panel open
  const btn = page.locator('.ai-split .ghost').first();
  await btn.click({ force: true }).catch(() => btn.evaluate(e => e.click()));
  await page.waitForTimeout(800);
  const tools = page.locator('.ch-tools').first();
  await tools.screenshot({ path: 'D:/AgentHive/qa/ai-tools.png' }).catch(() => { });
  const panel = page.locator('.ai-panel').first();
  const panelShot = await panel.screenshot({ path: 'D:/AgentHive/qa/ai-panel.png' }).catch(() => 'panel shot failed');
  return { kids, panelShot };
}
