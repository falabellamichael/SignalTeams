export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};

  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  await page.click('text=Agent Library');
  await page.waitForTimeout(900);
  await page.click('.acard:has-text("ToastMaster")');
  await page.waitForTimeout(700);
  await page.click('.ftab:has-text("History")');
  await page.waitForTimeout(800);
  out.histRows = await page.evaluate(() => document.querySelectorAll('.hist-row').length);
  await shot("history");

  // restore → edit modal prefilled with old snapshot
  await page.click('.hist-row button.restore:not(.ghost)');
  await page.waitForTimeout(700);
  out.editTitle = await page.evaluate(() => document.querySelector('.modal h3')?.innerText || 'no-edit-modal');
  out.editName = await page.evaluate(() => document.querySelector('.modal input')?.value);
  out.editVersion = await page.evaluate(() => [...document.querySelectorAll('.modal input')].map(i => i.value));
  await shot("restore-edit");

  // save the restore (PATCH) → history should gain a snapshot of v0.2.0
  await page.click('.modal .mfoot .primary, .modal button.primary');
  await page.waitForTimeout(900);
  out.afterSave = await page.evaluate(() => document.querySelector('.modal') ? 'modal-still-open' : 'closed');

  // reopen → history should now have 2 rows
  await page.click('.acard:has-text("ToastMaster")');
  await page.waitForTimeout(700);
  await page.click('.ftab:has-text("History")');
  await page.waitForTimeout(800);
  out.histRowsAfter = await page.evaluate(() => document.querySelectorAll('.hist-row').length);
  out.histTextAfter = await page.evaluate(() => document.querySelector('.hist-row')?.innerText.replace(/\n/g, ' | ').slice(0, 160));

  // verify restored tagline shows on card
  await page.click('.modal .mfoot .ghost, .shade').catch(() => {});
  await page.waitForTimeout(400);

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
