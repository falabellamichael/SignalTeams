export default async function run(page, ui) {
  const out = {};
  // fresh account — no invite, empty home
  await page.waitForSelector('input', { timeout: 25000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('.login-card .swap a')][0]?.click());
  await page.waitForTimeout(300);
  const uname = 'newbie' + Math.floor(Math.random() * 9000);
  await page.fill('input >> nth=0', uname);
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1800);
  out.card = await page.evaluate(() =>
    document.querySelector('.welcome-card')?.innerText);
  out.steps = await page.evaluate(() =>
    [...document.querySelectorAll('.wc-step')].map((s) => s.innerText.replace(/\n/g, ' | ')));
  await page.screenshot({ path: 'D:/AgentHive/qa-welcome.png' });
  // CTA: first step opens the server modal
  await page.evaluate(() =>
    [...document.querySelectorAll('.wc-step button')][0]?.click());
  await page.waitForTimeout(700);
  out.modalOpened = await page.evaluate(() =>
    document.querySelector('.modal, .modal-backdrop') ? document.querySelector('.modal-backdrop h3, .modal h3')?.innerText || 'open' : false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // dismiss → card gone + stays gone after reload
  await page.evaluate(() => document.querySelector('.wc-x')?.click());
  await page.waitForTimeout(300);
  out.afterDismiss = await page.evaluate(() => !!document.querySelector('.welcome-card'));
  await page.reload();
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  out.afterReload = await page.evaluate(() => !!document.querySelector('.welcome-card'));

  // established user: log in as mike (has crew+friends+bench) → no card
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:5175/?r=3');
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(2000);
  out.mikeCard = await page.evaluate(() => !!document.querySelector('.welcome-card'));
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
