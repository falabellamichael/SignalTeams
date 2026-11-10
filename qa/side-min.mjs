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
  // first clear any previously stored narrow width to start at default
  await page.evaluate(() => localStorage.removeItem('st.sidew'));
  await page.reload();
  await page.waitForTimeout(3500);
  const srv2 = page.locator('[title*="Signal HQ"]').first();
  await srv2.click({ force: true }).catch(() => srv2.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const grip = page.locator('.side-wrap > .side-drag').first();
  const gb = await grip.boundingBox();
  // drag hard LEFT (-200) — should clamp at 240
  await page.mouse.move(gb.x + 2, gb.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb.x - 200, gb.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const min = await page.evaluate(() => ({
    w: document.querySelector('.side-wrap').getBoundingClientRect().width,
    stored: localStorage.getItem('st.sidew'),
    meBarH: document.querySelector('.me-bar').getBoundingClientRect().height,
    lines: (() => {
      const n = document.querySelector('.me-bar .who .n');
      const s = document.querySelector('.me-bar .who .s');
      return { n: n?.getBoundingClientRect().height, s: s?.getBoundingClientRect().height };
    })()
  }));
  // then drag RIGHT +120 — should expand freely
  const gb2 = await grip.boundingBox();
  await page.mouse.move(gb2.x + 2, gb2.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb2.x + 122, gb2.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const max = await page.evaluate(() => ({
    w: document.querySelector('.side-wrap').getBoundingClientRect().width,
    meBarH: document.querySelector('.me-bar').getBoundingClientRect().height
  }));
  await page.screenshot({
    path: 'D:/AgentHive/qa/side-min.png',
    clip: { x: 0, y: 500, width: 480, height: 300 }
  });
  return { clampedAt: min, expandedTo: max };
}
