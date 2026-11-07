export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.setViewportSize({ width: 390, height: 780 });   // iPhone-ish
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1400);
  await shot("mob-home");
  out.burgerVisible = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.burger')).display !== 'none');
  out.sideHidden = await page.evaluate(() => {
    const r = document.querySelector('.side-wrap')?.getBoundingClientRect();
    return r ? r.right < 70 : null;
  });
  out.noHScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth + 2);

  // open the drawer, tap a server nav… drawer is only for home/server sidebar
  await page.evaluate(() => document.querySelector('.burger').click());
  await page.waitForTimeout(400);
  out.sideOpen = await page.evaluate(() => {
    const r = document.querySelector('.side-wrap')?.getBoundingClientRect();
    return r ? r.left >= 60 && r.right > 200 : null;
  });
  await shot("mob-drawer");

  // pick a channel → drawer auto-closes
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('Friends') || c.innerText.includes('Buzz'))?.click();
  });
  await page.waitForTimeout(800);
  out.sideClosedAfterNav = await page.evaluate(() => {
    const r = document.querySelector('.side-wrap')?.getBoundingClientRect();
    return r ? r.right < 70 : null;
  });

  // into a server channel to check chat at mobile width
  await page.click('.rail-ico[title="The Hive"]');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('.burger').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);
  out.chatTitle = await page.evaluate(() =>
    document.querySelector('.topbar .title')?.innerText);
  out.chatNoHScroll = await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth + 2);
  await shot("mob-chat");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
