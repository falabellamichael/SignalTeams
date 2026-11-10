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
    const w = document.querySelector('.side-wrap');
    w.style.width = '268px'; w.style.minWidth = '268px';
    const bar = document.querySelector('.me-bar');
    const n = bar.querySelector('.who .n'), s = bar.querySelector('.who .s');
    n.textContent = 'Michael Anthony';
    s.textContent = '@MichaelAnthony · online';
    const nr = n.getBoundingClientRect(), sr = s.getBoundingClientRect();
    // what stylesheet rule wins for white-space on .n ?
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch { continue; }
      for (const r of list) {
        if (r.selectorText && r.style && r.style.whiteSpace &&
          /me-bar|who/.test(r.selectorText)) {
          rules.push(r.selectorText + ' -> ws:' + r.style.whiteSpace);
        }
      }
    }
    return {
      nH: nr.height, sH: sr.height, rules,
      barH: bar.getBoundingClientRect().height
    };
  });
  await page.locator('.me-bar').first().screenshot({ path: 'D:/AgentHive/qa/mebar-el2.png' });
  return m;
}
