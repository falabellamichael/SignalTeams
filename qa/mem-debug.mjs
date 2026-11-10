export default async function run(page) {
  const tok = await page.evaluate(async () => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mike', password: 'password' })
    });
    return (await r.json()).token;
  });
  await page.evaluate((t) => localStorage.setItem('signalteams.token', t), tok);
  await page.reload();
  await page.waitForTimeout(4000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(3000);
  const gen = page.locator('span.txt', { hasText: 'general' }).first();
  await gen.click({ force: true }).catch(() => gen.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  // instrument via capture phase on document so React's synthetic system is bypassed
  await page.evaluate(() => {
    window.__log = [];
    document.addEventListener('mousedown', (e) =>
      window.__log.push('down:' + (e.target.className || '').toString().slice(0, 30)), true);
    document.addEventListener('mousemove', () => { if (window.__log.length < 40) window.__log.push('move'); }, true);
  });
  const gb = await page.locator('.members > .side-drag').first().boundingBox();
  await page.mouse.move(gb.x + 2, gb.y + 250);
  await page.mouse.down();
  await page.mouse.move(gb.x - 90, gb.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const log = await page.evaluate(() => window.__log);
  const w = await page.evaluate(() =>
    document.querySelector('.members').getBoundingClientRect().width);
  return {
    logFirst10: log.slice(0, 10), downCount: log.filter(l => l.startsWith('down')).length,
    moveCount: log.filter(l => l === 'move').length, memW: w
  };
}
