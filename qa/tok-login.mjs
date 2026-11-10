export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const b0 = (await page.locator('body').innerText()).length;
  // try direct login by posting to the API and injecting the token
  const tok = await page.evaluate(async () => {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mike', password: 'password' })
    });
    const j = await r.json();
    return j.token || null;
  });
  if (!tok) return { error: 'no token', b0 };
  await page.evaluate((t) => localStorage.setItem('signalteams.token', t), tok);
  await page.reload();
  await page.waitForTimeout(4000);
  const bc = (await page.locator('body').innerText()).length;
  return { token: !!tok, bodyChars: bc };
}
