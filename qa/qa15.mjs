export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(1600);
  out.pitch = await page.evaluate(() => ({
    h1: document.querySelector('.pitch h1')?.innerText,
    tag: document.querySelector('.pitch .tag')?.innerText,
    feats: document.querySelectorAll('.pitch .feats li').length,
    stats: document.querySelector('.lstats')?.innerText?.replace(/\n/g, ' ') || 'none',
    card: document.querySelector('.login-card h2')?.innerText,
  }));
  await shot("landing");
  // register-mode swap still works
  await page.click('text=Create an account');
  await page.waitForTimeout(400);
  out.regH2 = await page.evaluate(() => document.querySelector('.login-card h2')?.innerText);
  out.displayField = await page.evaluate(() =>
    [...document.querySelectorAll('.login-card label')].map((l) => l.innerText));
  await shot("landing-register");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
