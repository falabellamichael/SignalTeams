export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4500);
  const loggedIn = (await page.locator('body').innerText()).length > 2000;
  if (!loggedIn) return { error: 'login failed', body: (await page.locator('body').innerText()).slice(0, 200) };
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(3000);
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  const state0 = await page.evaluate(() => ({
    memCount: document.querySelectorAll('.members').length,
    gripCount: document.querySelectorAll('.members > .side-drag').length,
    memW: document.querySelector('.members')?.getBoundingClientRect().width
  }));
  if (!state0.gripCount) return { error: 'no grip', state0 };
  // widen: drag grip 90px left
  let gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x - 90, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const wider = await page.evaluate(() =>
  ({
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  // narrow: drag grip 200px right → clamps at 160
  gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x + 200, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const narrower = await page.evaluate(() =>
  ({
    memW: document.querySelector('.members').getBoundingClientRect().width,
    stored: localStorage.getItem('st.memw')
  }));
  await page.screenshot({
    path: 'D:/AgentHive/qa/mem-drag.png',
    clip: { x: 820, y: 0, width: 460, height: 600 }
  });
  return { state0, wider, narrower };
}
