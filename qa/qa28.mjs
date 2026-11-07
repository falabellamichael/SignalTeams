export default async function run(page, ui) {
  const out = {};
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(400);
  out.viewport = await page.evaluate(() => innerWidth);
  out.mq = await page.evaluate(() => matchMedia('(max-width: 760px)').matches);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1500);
  out.burger = await page.evaluate(() => {
    const b = document.querySelector('.burger');
    if (!b) return 'missing';
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return { display: cs.display, vis: cs.visibility, w: r.width, h: r.height,
             x: r.x, y: r.y };
  });
  return out;
}
