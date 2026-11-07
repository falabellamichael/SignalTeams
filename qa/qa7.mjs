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
  await page.click('text=general');
  await page.waitForTimeout(600);

  // pin a message via hover 📌 (the ghost pin button next to delete)
  await page.hover('.msg:has-text("eval\'d it on 40 diffs")');
  await page.waitForTimeout(300);
  await page.click('.msg:has-text("eval\'d it on 40 diffs") .del-msg[title="Pin"]');
  await page.waitForTimeout(600);
  out.pinFlag = await page.evaluate(() =>
    !!document.querySelector('.msg .pin-flag'));

  // open pins panel
  await page.click('.ch-tools button[title="Pinned messages"]');
  await page.waitForTimeout(600);
  out.pinsText = await page.evaluate(() =>
    document.querySelector('.ch-panel')?.innerText.slice(0, 200) || 'none');
  await shot("pins");

  // search panel
  await page.click('.ch-tools button[title="Search channel"]');
  await page.waitForTimeout(400);
  await page.fill('.ch-panel input', 'race');
  await page.waitForTimeout(700);
  out.searchHits = await page.evaluate(() =>
    document.querySelectorAll('.ch-panel .ideopt').length);
  await shot("search");

  // verify the dist build on :8075 serves too (navigate)
  await page.goto('http://127.0.0.1:8075/');
  await page.waitForTimeout(1000);
  out.distServes = await page.evaluate(() => document.body.innerText.slice(0, 60));
  return out;
}
