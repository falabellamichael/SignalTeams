export default async function run(page, ui) {
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1500);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(1800);

  return await page.evaluate(() => {
    const panel = document.querySelector('.ws-agent');
    const hint = panel?.querySelector('.idehint');
    const term = panel?.querySelector('.ws-term');
    const termInput = panel?.querySelector('.ws-term input');
    const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;
    return {
      panel: r(panel),
      panelScrollW: panel?.scrollWidth,
      panelClientW: panel?.clientWidth,
      hint: r(hint),
      hintScrollW: hint?.scrollWidth,
      hintText: hint?.innerText?.slice(0, 80),
      term: r(term),
      termInput: r(termInput),
      termInputW: termInput?.getBoundingClientRect().width,
      panelOverflowX: panel ? getComputedStyle(panel).overflowX : null,
    };
  });
}
