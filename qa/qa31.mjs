export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);

  out.msgCount = await page.evaluate(() => document.querySelectorAll('.msg').length);
  // dispatch contextmenu directly on a .msg
  out.menuOpened = await page.evaluate(() => {
    const m = document.querySelectorAll('.msg')[1];
    m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 }));
    return !!document.querySelector('.msg-menu');
  });
  out.menuItems = await page.evaluate(() =>
    [...document.querySelectorAll('.msg-menu .mm-item')].map((i) => i.innerText));
  await page.screenshot({ path: 'D:/AgentHive/qa-ctx-menu2.png' });
  return out;
}
