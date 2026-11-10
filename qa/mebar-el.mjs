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
  const m = await page.evaluate(() => {
    // pin floor width
    const w = document.querySelector('.side-wrap');
    w.style.width = '268px'; w.style.minWidth = '268px';
    const bar = document.querySelector('.me-bar');
    const n = bar.querySelector('.who .n'), s = bar.querySelector('.who .s');
    n.textContent = 'Michael Anthony';
    s.textContent = '@MichaelAnthony · online';
    // force sync layout read
    const nr = n.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    const acts = bar.querySelector('.me-actions').getBoundingClientRect();
    // hit test: is anything painting over the actions?
    const overActs = document.elementFromPoint(acts.x + 10, acts.y + acts.height / 2);
    return {
      meBarCount: document.querySelectorAll('.me-bar').length,
      nRect: { x: nr.x, w: nr.width, h: nr.height, right: nr.right },
      sRect: { x: sr.x, w: sr.width, h: sr.height, right: sr.right, sw: s.scrollWidth },
      actsRect: { x: acts.x, w: acts.width },
      overlap: sr.right > acts.x,
      nWS: getComputedStyle(n).whiteSpace,
      sWS: getComputedStyle(s).whiteSpace,
      sOv: getComputedStyle(s).overflow,
      topAtActs: overActs ? overActs.className.toString().slice(0, 40) : null,
    };
  });
  // element screenshot of the bar itself — cannot be mis-clipped
  await page.locator('.me-bar').first().screenshot({ path: 'D:/AgentHive/qa/mebar-el.png' });
  return m;
}
