export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  // who am I actually logged in as?
  const who = await page.evaluate(async () => {
    const r = await fetch('/api/me', {
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem('signalteams.token')
      }
    });
    const u = await r.json();
    return {
      username: u.username, display_name: u.display_name,
      status_text: u.status_text, status: u.status
    };
  });
  const srv = page.locator('[title*="Signal HQ"]').first();
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2500);
  // force the exact floor width
  await page.evaluate(() => {
    localStorage.setItem('st.sidew', '268');
    const w = document.querySelector('.side-wrap');
    w.style.width = '268px'; w.style.minWidth = '268px';
  });
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.me-bar');
    const who = bar.querySelector('.who');
    const n = who.querySelector('.n'), s = who.querySelector('.s');
    const cs = getComputedStyle(n), cs2 = getComputedStyle(s);
    const av = bar.querySelector('.avatar');
    return {
      barW: bar.getBoundingClientRect().width,
      whoW: who.getBoundingClientRect().width,
      nText: n.textContent, nH: n.getBoundingClientRect().height,
      nWS: cs.whiteSpace, nTO: cs.textOverflow, nOv: cs.overflow,
      sText: s.textContent, sH: s.getBoundingClientRect().height,
      sWS: cs2.whiteSpace,
      avW: av.getBoundingClientRect().width,
      actX: bar.querySelector('.me-actions').getBoundingClientRect().x,
      nRight: n.getBoundingClientRect().right,
      barLines: bar.innerText.split('\n').filter(Boolean),
    };
  });
  const side = await page.locator('.side-wrap').boundingBox();
  await page.screenshot({
    path: 'D:/AgentHive/qa/mebar-floor.png',
    clip: { x: side.x, y: side.y + side.height - 170, width: 300, height: 170 }
  });
  return { who, m };
}
