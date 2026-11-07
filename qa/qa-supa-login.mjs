export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('.login-card', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // create account via the Supabase tab — real supabase-js path
  await page.evaluate(() =>
    [...document.querySelectorAll('.login-card .swap a')]
      .find((a) => a.innerText.includes('Create'))?.click());
  await page.waitForTimeout(300);
  const email = `uibee${Date.now() % 100000}@gmail.com`;
  await page.fill('.login-card input[type="email"]', email);
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.login-card input')];
    inputs.find((i) => i.placeholder === 'optional')?.focus();
  });
  await page.evaluate((d) => {
    const inp = [...document.querySelectorAll('.login-card input')]
      .find((i) => i.placeholder === 'optional');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, d); inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'UI Bee');
  await page.fill('.login-card input[type="password"]', 'uibeetest123');
  await page.evaluate(() => document.querySelector('.login-card button.primary')?.click());
  await page.waitForTimeout(5000);
  out.landed = await page.evaluate(() => ({
    rail: document.querySelectorAll('.rail-ico').length,
    me: document.querySelector('.me-name, .mebar .nm, [class*="me"] b')?.innerText,
    welcome: !!document.querySelector('.welcome-card, [class*="welcome"]'),
    url: location.href.slice(0, 60),
  }));
  out.err = await page.evaluate(() =>
    document.querySelector('.login-card .err')?.innerText || null);
  out.email = email;
  return out;
}
