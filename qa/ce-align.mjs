export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  // open workspace
  const nav = page.locator('.ws-nav').first();
  await nav.click({ force: true, timeout: 8000 }).catch(() => nav.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  // open a tall file from the tree — db.py (24KB) is a good candidate
  const file = page.locator('text=db.py').first();
  await file.click({ force: true, timeout: 8000 }).catch(() => file.evaluate(e => e.click()));
  await page.waitForTimeout(2000);
  const ta = page.locator('.ce-ta');
  if (!(await ta.count())) return { error: 'no editor' };
  // click deep in the file (line ~460 = middle of db.py)
  const box = await ta.boundingBox();
  await page.mouse.click(box.x + 200, box.y + box.height / 2);
  await page.waitForTimeout(500);
  const r1 = await page.evaluate(() => {
    const on = document.querySelector('.ce-ln.on');
    const st = document.querySelector('.ce-status');
    const ln = [...document.querySelectorAll('.ce-ln')];
    // measure alignment: rect of the "on" gutter row vs the pre's line at that index
    const first = ln[0].getBoundingClientRect();
    return {
      onNumber: on?.textContent, status: st?.textContent,
      firstGutterY: first.y, lnCount: ln.length,
      gutterLineH: ln[1].getBoundingClientRect().y - first.y
    };
  });
  // also click near the top
  await page.mouse.click(box.x + 200, box.y + 30);
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => ({
    onNumber: document.querySelector('.ce-ln.on')?.textContent,
    status: document.querySelector('.ce-status')?.textContent
  }));
  // scroll deep and click again
  await ta.evaluate(e => { e.scrollTop = 3000; e.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(400);
  await page.mouse.click(box.x + 200, box.y + 100);
  await page.waitForTimeout(400);
  const r3 = await page.evaluate(() => ({
    onNumber: document.querySelector('.ce-ln.on')?.textContent,
    status: document.querySelector('.ce-status')?.textContent
  }));
  await page.screenshot({
    path: 'D:/AgentHive/qa/ce-align.png',
    clip: { x: 0, y: 60, width: 700, height: 500 }
  });
  return { mid: r1, top: r2, deep: r3 };
}
