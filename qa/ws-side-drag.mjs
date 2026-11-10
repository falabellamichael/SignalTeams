export default async function run(page) {
  const out = {};
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
  const nav = page.locator('.ws-nav').first();
  await nav.click({ force: true, timeout: 8000 }).catch(() => nav.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const grip = page.locator('.ws-side-drag').first();
  out.grip = await grip.count();
  if (!out.grip) return out;
  const before = await page.evaluate(() => ({
    side: document.querySelector('.ws-side')?.getBoundingClientRect().width,
    status: document.querySelector('.ce-status')?.getBoundingClientRect().height
      ?? document.querySelector('.ws-head')?.getBoundingClientRect().height
  }));
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb.x + 142, gb.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    side: document.querySelector('.ws-side')?.getBoundingClientRect().width,
    stored: localStorage.getItem('st.wsside')
  }));
  out.tree = { before, after };
  await page.screenshot({
    path: 'D:/AgentHive/qa/ws-side-drag.png',
    clip: { x: 180, y: 0, width: 900, height: 500 }
  });
  return out;
}
