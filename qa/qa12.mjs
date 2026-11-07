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
  await page.waitForTimeout(700);

  // send a message, hover, edit it
  await page.fill('.composer textarea', 'typo heer');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  await page.hover('.msg:has-text("typo heer")');
  await page.waitForTimeout(400);
  await page.click('.msg:has-text("typo heer") .react-bar span[title="Edit"]');
  await page.waitForTimeout(400);
  await page.fill('.edit-row textarea', 'typo here — fixed inline');
  await shot("edit-mode");
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  out.editedText = await page.evaluate(() =>
    [...document.querySelectorAll('.msg .text')].pop()?.innerText);
  out.editedFlag = await page.evaluate(() =>
    !!document.querySelector('.msg .edited'));
  await shot("edited");

  // agent history → diff view
  await page.click('.rail-ico >> nth=0');
  await page.waitForTimeout(500);
  await page.click('text=Agent Library');
  await page.waitForTimeout(800);
  await page.click('.acard:has-text("ToastMaster")');
  await page.waitForTimeout(700);
  await page.click('.ftab:has-text("History")');
  await page.waitForTimeout(700);
  out.diffBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.hist-row .restore.ghost')].map((b) => b.innerText));
  // click the first diff button (second ghost button in row: peek, diff)
  await page.click('.hist-row .restore.ghost >> nth=1');
  await page.waitForTimeout(500);
  out.diffRows = await page.evaluate(() =>
    [...document.querySelectorAll('.diff-row')].map((r) =>
      r.querySelector('.df')?.innerText + ': ' +
      r.querySelector('.old')?.innerText.slice(0, 30) + ' → ' +
      r.querySelector('.new')?.innerText.slice(0, 30)));
  await shot("history-diff");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
