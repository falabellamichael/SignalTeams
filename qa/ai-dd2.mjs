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
  // inspect the toolbar buttons
  const btns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ch-tools > *')).map(e =>
      (e.className || '') + ' :: ' + (e.getAttribute('title') || e.textContent.trim().slice(0, 20))));
  // open dropdown and KEEP it open (no further clicks) then shoot
  const btn = page.locator('.ai-split .ghost').first();
  await btn.click({ force: true }).catch(() => btn.evaluate(e => e.click()));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'D:/AgentHive/qa/ai-dd2.png', fullPage: false });
  const panelText = await page.evaluate(() => {
    const p = document.querySelector('.ai-panel');
    return p ? p.innerText.slice(0, 300) : 'PANEL GONE';
  });
  return { btns, panelText };
}
