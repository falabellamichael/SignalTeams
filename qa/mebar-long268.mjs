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
  // pin the sidebar at the floor and inject the long-name content
  const m = await page.evaluate(() => {
    const w = document.querySelector('.side-wrap');
    w.style.width = '268px'; w.style.minWidth = '268px';
    const bar = document.querySelector('.me-bar');
    const n = bar.querySelector('.who .n'), s = bar.querySelector('.who .s');
    n.textContent = 'Michael Anthony';
    s.textContent = '@MichaelAnthony · online';
    return {
      nH: n.getBoundingClientRect().height,     // 1 line ≈ 19px, 2 lines ≈ 38
      sH: s.getBoundingClientRect().height,
      barH: bar.getBoundingClientRect().height,
      sOverflowX: s.scrollWidth > s.clientWidth ? 'clipped(ellipsis)' : 'fits',
    };
  });
  const side = await page.locator('.side-wrap').boundingBox();
  await page.screenshot({
    path: 'D:/AgentHive/qa/mebar-long268.png',
    clip: { x: side.x, y: side.y + side.height - 170, width: 300, height: 170 }
  });
  return m;
}
