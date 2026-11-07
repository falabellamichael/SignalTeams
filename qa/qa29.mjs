export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);

  // right-click a message → context menu
  const box = await page.locator('.msg >> nth=1').boundingBox();
  await page.mouse.click(box.x + 200, box.y + 10, { button: 'right' });
  await page.waitForTimeout(500);
  out.menuItems = await page.evaluate(() =>
    [...document.querySelectorAll('.msg-menu .mm-item')].map((i) => i.innerText));
  await shot("ctx-menu");

  // Reply via menu → banner
  await page.evaluate(() => {
    [...document.querySelectorAll('.msg-menu .mm-item')]
      .find((i) => i.innerText.includes('Reply'))?.click();
  });
  await page.waitForTimeout(500);
  out.replyBanner = await page.evaluate(() =>
    document.querySelector('.reply-banner')?.innerText?.replace(/\n/g, ' ').slice(0, 60) || null);
  await page.evaluate(() => document.querySelector('.reply-banner .ghost')?.click());

  // right-click own message → Edit present
  const myMsg = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg')];
    const mine = msgs.findLast((m) =>
      m.querySelector('.author')?.innerText === 'Mike');
    const r = mine?.getBoundingClientRect();
    return r ? { x: r.x + 100, y: r.y + 5 } : null;
  });
  if (myMsg) {
    await page.mouse.click(myMsg.x, myMsg.y, { button: 'right' });
    await page.waitForTimeout(400);
    out.ownMenuItems = await page.evaluate(() =>
      [...document.querySelectorAll('.msg-menu .mm-item')].map((i) => i.innerText));
    await page.evaluate(() => document.querySelector('.menu-scrim')?.click());
  }

  // manifest + icon serve from the dev server
  out.manifest = await page.evaluate(async () => {
    const r = await fetch('/manifest.webmanifest');
    const j = await r.json();
    return { status: r.status, name: j.short_name, icons: j.icons.length };
  });
  out.icon192 = await page.evaluate(async () =>
    (await fetch('/icon-192.png')).status);
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
