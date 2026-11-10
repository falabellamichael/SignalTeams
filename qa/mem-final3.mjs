export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4500);
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(3000);
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const probe = await page.evaluate(() => {
    const g = document.querySelector('.members > .side-drag');
    const r = g.getBoundingClientRect();
    const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + 250);
    const top = document.elementFromPoint(cx, cy);
    const chain = [];
    let e = top;
    while (e && chain.length < 6) { chain.push(e.tagName + '.' + String(e.className).slice(0, 30)); e = e.parentElement; }
    return {
      gripRect: { x: r.x, y: r.y, w: r.width, h: r.height }, pt: { cx, cy }, chain,
      hasHandler: !!g.onmousedown || 'react-synthetic'
    };
  });
  // drag exactly at the probed point
  await page.mouse.move(probe.pt.cx, probe.pt.cy);
  await page.mouse.down();
  await page.mouse.move(probe.pt.cx - 90, probe.pt.cy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() =>
  ({
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  return { probe, after };
}
