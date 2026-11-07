export default async function run(page, ui) {
  const out = {};
  // fresh browser → landing/login should show with provider tabs
  await page.waitForSelector('.login-card', { timeout: 25000 });
  await page.waitForTimeout(1200);
  out.tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.prov-tabs button')].map((b) => ({
      label: b.innerText, on: b.classList.contains('on') })));
  out.fields = await page.evaluate(() => ({
    email: !!document.querySelector('.login-card input[type="email"]'),
    cta: document.querySelector('.login-card button.primary')?.innerText,
  }));
  // flip to crew tab
  await page.evaluate(() =>
    [...document.querySelectorAll('.prov-tabs button')]
      .find((b) => b.innerText.includes('crew'))?.click());
  await page.waitForTimeout(300);
  out.crew = await page.evaluate(() => ({
    username: !!document.querySelector('.login-card input:not([type])'),
    cta: document.querySelector('.login-card button.primary')?.innerText,
  }));
  return out;
}
