export default async function run(page, ui) {
  // login flow only — inspect what's on screen after
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'D:/AgentHive/qa/ai-where.png' });
  return (await page.locator('body').innerText()).slice(0, 400);
}
