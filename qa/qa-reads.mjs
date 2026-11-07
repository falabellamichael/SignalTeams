export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  const hasLogin = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="password"]')].length > 0);
  if (hasLogin) {
    await page.fill('input >> nth=0', 'mike');
    await page.fill('input[type="password"]', 'password');
    await page.click('button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);

  // sidebar stretch: .side and .side-wrap should be viewport-tall, me-bar at bottom
  out.layout = await page.evaluate(() => {
    const wrap = document.querySelector('.side-wrap')?.getBoundingClientRect();
    const side = document.querySelector('.side')?.getBoundingClientRect();
    const meb = document.querySelector('.me-bar')?.getBoundingClientRect();
    return { vh: innerHeight,
             wrap: wrap && { top: wrap.top, h: wrap.height },
             side: side && { top: side.top, h: side.height },
             meBarBottom: meb && Math.round(meb.bottom) };
  });

  // open the DM with nova — "receipt probe" should show ✓✓ seen (nova marked via API)
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Home') || i.title === '⌂' || i.title === 'SignalTeams')?.click());
  await page.waitForTimeout(1200);
  out.dmRows = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')].map((r) => r.innerText.trim()).slice(0, 8));
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item')]
      .find((r) => /Nova/.test(r.innerText) && !/\d/.test(r.innerText))?.click());
  await page.waitForTimeout(1500);
  out.seen = await page.evaluate(() => {
    const tag = document.querySelector('.seen-tag');
    return tag ? { text: tag.innerText, title: tag.title } : null;
  });
  return out;
}
