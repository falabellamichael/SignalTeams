export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1400);

  out.embedCards = await page.evaluate(() =>
    [...document.querySelectorAll('.embed')].map((e) => ({
      site: e.querySelector('.embed-site')?.innerText,
      title: e.querySelector('.embed-title')?.innerText,
      desc: e.querySelector('.embed-desc')?.innerText?.slice(0, 60),
    })));
  await page.evaluate(() => document.querySelector('.embed')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'D:/AgentHive/qa-embed.png' });

  // bell: unseen badge uses server-side seen_buzz; opening it should clear + persist
  const badge = () => page.evaluate(() =>
    document.querySelector('button[title="Notifications"] .rail-badge')?.innerText ?? null);
  out.badgeBefore = await badge();
  await page.click('button[title="Notifications"]');
  await page.waitForTimeout(700);
  out.badgeAfter = await badge();
  out.seenBuzz = await page.evaluate(async () => {
    const r = await fetch('/api/me', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('signalteams.token') },
    });
    return (await r.json()).seen_buzz;
  });
  return out;
}
