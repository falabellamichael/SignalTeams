export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa/qa-llmdd-${n}.png` });
  const out = {};

  await page.waitForTimeout(800);
  await page.click('button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary:has-text("Sign in")');
  await page.waitForTimeout(1500);

  // Settings gear (bottom-left user bar)
  await page.click('.mebar .gear, button[title*="ettings"], .me-gear').catch(() => {});
  await page.waitForTimeout(600);
  // fallback: the gear icon next to username
  if (!(await page.$('.modal'))) {
    await page.click('.rail-ico >> nth=0').catch(() => {});
    await page.click('text=Settings').catch(() => {});
    await page.waitForTimeout(600);
  }
  await shot("settings");

  out.lists = await page.evaluate(() =>
    [...document.querySelectorAll('input[list]')].map((i) => ({
      placeholder: i.placeholder,
      options: [...(document.getElementById(i.getAttribute("list"))?.options || [])]
        .map((o) => o.value).length,
    })));

  // open a server settings modal too — server rail icon, then settings
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1000);
  await page.click('button:has-text("Settings"), [title*="settings"]').catch(() => {});
  await page.waitForTimeout(600);
  await shot("srvsettings");
  out.srvLists = await page.evaluate(() =>
    [...document.querySelectorAll('input[list]')].map((i) => ({
      placeholder: i.placeholder,
      options: [...(document.getElementById(i.getAttribute("list"))?.options || [])]
        .map((o) => o.value).length,
    })));

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
