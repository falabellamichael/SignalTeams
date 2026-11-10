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
  // simulate the long-name user: inject "Michael Anthony" + long handle into the bar
  return await page.evaluate(() => {
    const bar = document.querySelector('.me-bar');
    const n = bar.querySelector('.who .n'), s = bar.querySelector('.who .s');
    const oldN = n.textContent, oldS = s.textContent;
    n.textContent = 'Michael Anthony';
    s.textContent = '@MichaelAnthony · online';
    // natural width the bar wants with no wrap allowed anywhere
    const probe = bar.cloneNode(true);
    probe.style.cssText =
      'position:absolute;visibility:hidden;width:auto;max-width:none;white-space:nowrap;';
    document.body.appendChild(probe);
    const natural = probe.getBoundingClientRect().width;
    probe.remove();
    n.textContent = oldN; s.textContent = oldS;
    return { naturalWithLongName: Math.ceil(natural) };
  });
}
