export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  if (await page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].length > 0)) {
    await page.evaluate(() =>
      [...document.querySelectorAll('.prov-tabs button')]
        .find((b) => b.innerText.includes('crew'))?.click());
    await page.waitForTimeout(200);
    await page.fill('.login-card input:not([type="password"]):not([type="email"])', 'mike');
    await page.fill('.login-card input[type="password"]', 'password');
    await page.click('.login-card button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // pulse button only inside a server
  out.btnBefore = await page.evaluate(() =>
    [...document.querySelectorAll('.topbar button')].some((b) => b.title.includes('pulse')));
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  out.btnInServer = await page.evaluate(() =>
    [...document.querySelectorAll('.topbar button')].some((b) => b.title.includes('pulse')));
  await page.evaluate(() =>
    [...document.querySelectorAll('.topbar button')].find((b) => b.title.includes('pulse'))?.click());
  await page.waitForTimeout(900);
  out.pulse = await page.evaluate(() => {
    const m = document.querySelector('.modal');
    return m && {
      title: m.querySelector('.mtitle, h2, b')?.innerText?.slice(0, 40),
      bars: m.querySelectorAll('.pb-bar').length,
      stats: [...m.querySelectorAll('.ps')].map((s) => s.innerText.replace('\n', ' ')),
      rows: [...m.querySelectorAll('.pr')].map((r) => r.innerText.replace(/\n/g, ' | ')),
    };
  });
  return out;
}
