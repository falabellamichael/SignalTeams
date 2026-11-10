export default async function run(page) {
  const out = {};
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  // enter server
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  // measure sidebar + footer before drag
  const before = await page.evaluate(() => ({
    side: document.querySelector('.side-wrap')?.getBoundingClientRect().width,
    meBar: document.querySelector('.me-bar')?.getBoundingClientRect().height
  }));
  // drag the sidebar grip right by +120
  const grip = page.locator('.side-wrap > .side-drag').first();
  out.gripCount = await grip.count();
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + 200);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 120, gb.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    side: document.querySelector('.side-wrap')?.getBoundingClientRect().width,
    meBar: document.querySelector('.me-bar')?.getBoundingClientRect().height,
    stored: localStorage.getItem('st.sidew')
  }));
  // drag it back narrower
  const gb2 = await grip.boundingBox();
  await page.mouse.move(gb2.x + gb2.width / 2, gb2.y + 200);
  await page.mouse.down();
  await page.mouse.move(gb2.x + gb2.width / 2 - 60, gb2.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after2 = await page.evaluate(() => ({
    side: document.querySelector('.side-wrap')?.getBoundingClientRect().width,
    stored: localStorage.getItem('st.sidew')
  }));
  out.sidebar = { before, after, afterNarrow: after2 };
  await page.screenshot({
    path: 'D:/AgentHive/qa/side-drag.png',
    clip: { x: 0, y: 0, width: 700, height: 800 }
  });
  return out;
}
