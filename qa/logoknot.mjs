// verify the rail home button + icon surfaces use the knot mark
export default async function run(page, ui) {
  const out = {};
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2200);

  const rail = page.locator(".rail .rail-ico").first();
  out.railHasKnot = (await rail.locator(".knotmark").count()) === 1;
  out.railKnotColor = await rail.locator(".knotmark")
    .evaluate((e) => getComputedStyle(e).color).catch(() => null);
  out.railEmoji = await rail.evaluate((e) => e.innerText.trim());

  // crop the rail top for a look
  const box = await rail.boundingBox();
  if (box) await page.screenshot({ path: "qa/logoknot.png", clip: {
    x: box.x - 4, y: Math.max(0, box.y - 4), width: 70, height: 70 } });
  return out;
}
