export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'nova');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1200);

  // react to a message in general
  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);
  await page.click('text=general');
  await page.waitForTimeout(600);
  await page.hover('.msg:has-text("welcome to the hive")');
  await page.waitForTimeout(300);
  await page.click('.msg:has-text("welcome to the hive") .react-bar span >> nth=0'); // 👍
  await page.waitForTimeout(600);
  out.rchip = await page.evaluate(() =>
    document.querySelector('.rchip')?.textContent.trim() || 'none');
  await shot("reaction");

  // fork SousChef
  await page.click('.rail-ico >> nth=0');
  await page.waitForTimeout(400);
  await page.click('text=Agent Library');
  await page.waitForTimeout(800);
  await page.click('.acard:has-text("SousChef")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Fork")');
  await page.waitForTimeout(800);
  await shot("fork-edit");
  out.forkEditOpen = await page.evaluate(() =>
    document.body.innerText.includes('Edit SousChef') || document.body.innerText.includes('Save changes'));
  // save it
  await page.click('.modal button.primary');
  await page.waitForTimeout(800);
  out.forkedInLib = await page.evaluate(() =>
    document.body.innerText.includes('by Nova (you)') || document.body.innerText.includes('(you)'));
  await shot("forked");

  return out;
}
