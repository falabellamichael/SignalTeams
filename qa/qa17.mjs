export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);

  // create a scratch channel to edit/delete
  await page.click('.side-group:has-text("Text channels") .add');
  await page.waitForTimeout(500);
  await page.fill('.modal input >> nth=0', 'scratch-qa');
  await page.click('.modal button.primary');
  await page.waitForTimeout(900);
  out.created = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')].map((t) => t.innerText));

  // owner sees the gear on hover
  await page.hover('.nav-item:has-text("scratch-qa")');
  await page.waitForTimeout(300);
  out.gear = await page.evaluate(() =>
    !![...document.querySelectorAll('.nav-item')]
      .find((n) => n.innerText.includes('scratch-qa'))?.querySelector('.ch-gear'));
  await page.click('.nav-item:has-text("scratch-qa") .ch-gear');
  await page.waitForTimeout(500);
  await shot("chan-edit");
  await page.fill('.modal input >> nth=0', 'renamed-qa');
  await page.fill('.modal input >> nth=1', 'temporary channel');
  await page.click('.modal button.primary');
  await page.waitForTimeout(800);
  out.renamed = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')].map((t) => t.innerText)
      .filter((t) => t.includes('qa')));
  out.topic = await page.evaluate(() =>
    document.querySelector('.chat-head .topic, .topbar .topic')?.innerText || '');

  // delete it via the gear
  await page.hover('.nav-item:has-text("renamed-qa")');
  await page.click('.nav-item:has-text("renamed-qa") .ch-gear');
  await page.waitForTimeout(400);
  page.once('dialog', (d) => d.accept());
  await page.click('.modal button.danger');
  await page.waitForTimeout(900);
  out.afterDelete = await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')].map((t) => t.innerText)
      .filter((t) => t.includes('qa')));
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
