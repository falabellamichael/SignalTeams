export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // full login, into the server, measure me-bar lines at the clamp width
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.me-bar');
    if (!bar) return { error: 'no me-bar' };
    const who = bar.querySelector('.who');
    const n = who.querySelector('.n'), s = who.querySelector('.s');
    // force the widest real content
    return {
      barW: bar.getBoundingClientRect().width,
      whoW: who.getBoundingClientRect().width,
      nH: n.getBoundingClientRect().height,
      sH: s.getBoundingClientRect().height,
      nText: n.textContent, sText: s.textContent,
      nScroll: n.scrollWidth, sScroll: s.scrollWidth,
      barText: bar.innerText.replace(/\n/g, ' | ').slice(0, 120),
    };
  });
  const side = await page.locator('.side-wrap').boundingBox();
  await page.screenshot({
    path: 'D:/AgentHive/qa/mebar-now.png',
    clip: { x: side.x, y: side.y + side.height - 170, width: Math.max(240, side.width), height: 170 }
  });
  return m;
}
