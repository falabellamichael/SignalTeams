export default async function run(page) {
  const tok = await page.evaluate(async () => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mike', password: 'password' })
    });
    return (await r.json()).token;
  });
  await page.evaluate((t) => localStorage.setItem('signalteams.token', t), tok);
  await page.reload();
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(3000);
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const s0 = await page.evaluate(() =>
    document.querySelector('.members')?.getBoundingClientRect().width || null);
  if (!s0) return { error: 'no members panel' };
  // widen: drag grip 90px left
  let gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x - 90, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const wider = await page.evaluate(() =>
  ({
    w: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  // narrow: drag 300px right → clamp at 160
  gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x + 300, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const clamped = await page.evaluate(() =>
  ({
    w: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  await page.screenshot({
    path: 'D:/AgentHive/qa/mem-drag.png',
    clip: { x: 760, y: 60, width: 520, height: 560 }
  });
  return { before: s0, wider, clamped };
}
