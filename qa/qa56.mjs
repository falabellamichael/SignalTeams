export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // open Saved nav → should list the API-saved message
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('Saved'))?.click());
  await page.waitForTimeout(1400);
  out.savedRows = await page.evaluate(() =>
    [...document.querySelectorAll('.inbox-row')].map((r) =>
      r.innerText.trim().replace(/\s+/g, ' ').slice(0, 60)));
  // right-click a message in #general → Save label state
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1600);
  const box = await page.locator('.msg').last().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 5, { button: 'right' });
  await page.waitForTimeout(500);
  out.menuSave = await page.evaluate(() =>
    [...document.querySelectorAll('.mm-item')].map((i) => i.innerText)
      .find((t) => t.includes('Save')));
  await page.screenshot({ path: 'D:/AgentHive/qa-save-menu.png' });
  // click Save → then Saved view should show 2 rows
  await page.evaluate(() =>
    [...document.querySelectorAll('.mm-item')].find((i) => i.innerText.includes('Save'))?.click());
  await page.waitForTimeout(600);
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('Saved'))?.click());
  await page.waitForTimeout(1200);
  out.afterSave = await page.evaluate(() => document.querySelectorAll('.inbox-row').length);
  return out;
}
