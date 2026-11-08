export default async function run(page, ui) {
  const out = { steps: [] };
  await page.reload();
  await page.waitForTimeout(3500);
  // login if needed
  const body = await page.locator('body').innerText();
  if (!/Signal HQ|Buzz|FEED/i.test(body)) {
    const crew = page.locator('text=crew account, button:has-text("crew"), div:has-text("crew account")').first();
    if (await crew.count()) await crew.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('input').first().fill('mike');
    await page.locator('input[type=password]').first().fill('password');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3500);
  }
  out.loggedIn = /Signal HQ|Buzz/i.test(await page.locator('body').innerText());
  // enter server (nav dock item has a title like "Signal HQ — drag to reorder")
  const srv = page.locator('[title*="Signal HQ"]').first();
  if (await srv.count()) {
    await srv.click({ force: true, timeout: 8000 }).catch(async () => {
      await srv.evaluate(e => e.click());
    });
  } else {
    out.steps.push('no server icon — already in?');
  }
  await page.waitForTimeout(2500);
  out.inServer = (await page.locator('body').innerText()).includes('CHANNELS');
  // open #general channel
  await page.evaluate(() => {
    const span = Array.from(document.querySelectorAll('span'))
      .find(s => s.textContent.trim() === 'general');
    if (span) { let t = span; for (let i = 0; i < 4 && t.parentElement; i++) t = t.parentElement; t.click(); }
  });
  await page.waitForTimeout(2000);
  out.toolCount = await page.locator('.ch-tools').count();
  // click the AI dropdown button
  const btn = page.locator('.ai-split .ghost').first();
  out.btnCount = await btn.count();
  if (!out.btnCount) { out.steps.push('AI button NOT found'); return out; }
  await btn.click();
  await page.waitForTimeout(800);
  out.panelOpen = await page.locator('.ai-panel').count() > 0;
  out.items = await page.locator('.ai-item').count();
  // toggle the first item on
  await page.locator('.ai-item').first().click();
  await page.waitForTimeout(500);
  out.toggledOn = await page.locator('.ai-item.on').count();
  await page.screenshot({ path: 'D:/AgentHive/qa/ai-dd.png' });
  return out;
}
