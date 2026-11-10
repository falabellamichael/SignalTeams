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
  const grip = page.locator('.side-wrap > .side-drag').first();
  const gb = await grip.boundingBox();
  // drag hard left to force the clamp
  await page.mouse.move(gb.x + 2, gb.y + 300);
  await page.mouse.down();
  await page.mouse.move(gb.x - 200, gb.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.me-bar');
    const who = bar.querySelector('.who');
    const n = bar.querySelector('.who .n');
    const acts = bar.querySelector('.me-actions');
    return {
      sideW: document.querySelector('.side-wrap').getBoundingClientRect().width,
      barW: bar.getBoundingClientRect().width,
      whoW: who.getBoundingClientRect().width,
      nH: n.getBoundingClientRect().height,          // one line ≈ 19, two ≈ 38
      nText: n.textContent,
      actsW: acts.getBoundingClientRect().width,
      actsX: acts.getBoundingClientRect().x,
      nX: n.getBoundingClientRect().x, nRight: n.getBoundingClientRect().right,
    };
  });
  // full-height shot of just the sidebar column
  const side = await page.locator('.side-wrap').boundingBox();
  await page.screenshot({
    path: 'D:/AgentHive/qa/side-clamp.png',
    clip: { x: side.x, y: side.y + side.height - 160, width: side.width, height: 160 }
  });
  return m;
}
