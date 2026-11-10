export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(1500);
  // real login via the auth form (two inputs + submit)
  const inputs = page.locator('input');
  const n = await inputs.count();
  const body0 = await page.locator('body').innerText();
  return { inputs: n, body0: body0.slice(0, 500) };
}
