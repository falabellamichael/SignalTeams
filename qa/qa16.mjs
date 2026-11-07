export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  // home → library → packs tab
  await page.click('.rail-ico >> nth=0');
  await page.waitForTimeout(800);
  await page.click('text=Agent Library');
  await page.waitForTimeout(800);
  await page.click('.ftab:has-text("Packs")');
  await page.waitForTimeout(700);
  await shot("packs-tab");

  // two "QA Pack" cards — Mike's (forkable) vs mine (has ⑂ badge)
  out.cards = await page.evaluate(() =>
    [...document.querySelectorAll('.acard .by')].map((b) => b.innerText));
  // open Mike's original (the one without "(you)")
  const idx = out.cards.findIndex((t) => !t.includes("(you)") && t.includes("Mike"));
  await page.click(`.acard >> nth=${idx}`);
  await page.waitForTimeout(900);
  out.modalSub = await page.evaluate(() =>
    document.querySelector('.modal .msub, .modal h3 + div, .modal .sub')?.innerText || '');
  out.forkBtn = await page.evaluate(() =>
    !!([...document.querySelectorAll('.modal button')].find((b) => b.innerText.includes('Fork'))));
  await shot("pack-fork-modal");
  // my clone shows the ⑂ badge in its modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
