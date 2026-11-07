export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'nova');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1200);

  // library — check icons rendered
  await page.click('text=Agent Library');
  await page.waitForTimeout(800);
  out.icons = await page.evaluate(() =>
    [...document.querySelectorAll('.acard .aicon')].map((e) => e.textContent));
  await shot("lib-icons");

  // send markdown in general
  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);
  await page.click('text=general');
  await page.waitForTimeout(600);
  await page.fill('.composer textarea', 'testing **bold** and `code` and\n```\na block\n```');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  out.md = await page.evaluate(() => ({
    bold: !!document.querySelector('.msg .text b'),
    code: !!document.querySelector('.msg .md-code'),
    pre: !!document.querySelector('.msg .md-pre'),
  }));
  await shot("md");

  // delete own message via hover ✕
  await page.hover('.msg:has-text("testing")');
  await page.waitForTimeout(300);
  await page.click('.msg:has-text("testing") .del-msg');
  await page.waitForTimeout(600);
  out.deleted = await page.evaluate(() => !document.body.innerText.includes('a block'));

  return out;
}
