export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  if (await page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].length > 0)) {
    // crew tab first
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
  // open user settings (me-bar gear)
  await page.evaluate(() => document.querySelector('.mebar .gear, [title="Settings"]')?.click());
  await page.waitForTimeout(800);
  out.account = await page.evaluate(() => {
    const modal = document.querySelector('.modal');
    const lbl = [...(modal?.querySelectorAll('label') || [])].find((l) => l.innerText.includes('Account'));
    const pwInputs = [...(modal?.querySelectorAll('input[type="password"]') || [])]
      .map((i) => i.placeholder);
    const ghost = [...(modal?.querySelectorAll('button') || [])]
      .find((b) => b.innerText.includes('other devices'));
    return { label: lbl?.innerText, pwInputs, signoutBtn: !!ghost };
  });
  // change password end-to-end in UI
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('.modal input[type="password"]')];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp[0], 'password'); inp[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inp[1], 'mikepw999'); inp[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() =>
    [...document.querySelectorAll('.modal button')].find((b) => b.innerText === 'Change')?.click());
  await page.waitForTimeout(800);
  out.msg = await page.evaluate(() =>
    [...document.querySelectorAll('.modal div')].map((d) => d.innerText)
      .find((t) => t && t.includes('signed out')) || null);
  // restore
  await page.evaluate(async () => {
    const tok = localStorage.getItem('signalteams.token');
    await fetch('/api/me/password', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ current: 'mikepw999', next: 'password' }) });
  });
  return out;
}
