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
  // binary-search-free: measure the natural (unconstrained) width of the me-bar
  return await page.evaluate(() => {
    const bar = document.querySelector('.me-bar');
    // clone it, set width:auto, see how wide it wants to be
    const probe = bar.cloneNode(true);
    probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;white-space:nowrap;display:flex;';
    document.body.appendChild(probe);
    const natural = probe.getBoundingClientRect().width;
    probe.remove();
    // also measure with the voice bar present
    const vbar = document.querySelector('.vc-bar, [class*=voice-connected]');
    return {
      naturalMeBar: Math.ceil(natural),
      currentSide: document.querySelector('.side-wrap').getBoundingClientRect().width,
      voiceBar: vbar ? vbar.className : null
    };
  });
}
