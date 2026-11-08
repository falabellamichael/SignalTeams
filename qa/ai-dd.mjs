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
  // open the AI dropdown
  const btn = page.locator('.ai-split .ghost').first();
  await btn.click({ force: true }).catch(() => btn.evaluate(e => e.click()));
  await page.waitForTimeout(600);
  const open = await page.locator('.ai-panel').count();
  const items = await page.locator('.ai-item').count();
  // toggle "Web search" on
  const first = page.locator('.ai-item').first();
  await first.click().catch(() => first.evaluate(e => e.click()));
  await page.waitForTimeout(400);
  const onCount = await page.locator('.ai-item.on').count();
  // persist check
  const stored = await page.evaluate(() => {
    const k = Object.keys(localStorage).find(k => k.startsWith('signalteams.ai.'));
    return k ? k + '=' + localStorage.getItem(k) : 'none';
  });
  await page.screenshot({ path: 'D:/AgentHive/qa/ai-dd.png' });
  return { open, items, onCount, stored };
}
