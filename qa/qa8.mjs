import { writeFileSync } from "fs";

export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};

  // fixtures
  writeFileSync("D:/AgentHive/qa-pic.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" rx="12" fill="#2b6cb0"/><text x="120" y="66" font-size="20" fill="#fff" text-anchor="middle" font-family="sans-serif">hive upload test</text></svg>`);
  writeFileSync("D:/AgentHive/qa-notes.txt", "agenthive attachment smoke test\nline two\n");

  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);
  await page.click('text=general');
  await page.waitForTimeout(700);

  // attach image + text file via hidden file input
  await page.setInputFiles('.composer input[type="file"]', ["D:/AgentHive/qa-pic.svg", "D:/AgentHive/qa-notes.txt"]);
  await page.waitForTimeout(1200);
  out.pendingChips = await page.evaluate(() => document.querySelectorAll('.att-chip').length);
  await shot("attach-pending");

  await page.fill('.composer input[type="text"], .composer textarea', 'check these attachments');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  out.attImgs = await page.evaluate(() => document.querySelectorAll('.msg .att-img').length);
  out.attFiles = await page.evaluate(() => document.querySelectorAll('.msg .att-file').length);
  out.imgLoaded = await page.evaluate(() => {
    const im = [...document.querySelectorAll('.msg .att-img')].pop();
    return im ? im.complete && im.naturalWidth > 0 : false;
  });
  await shot("attach-msg");

  // agent modal → history tab (ToastMaster has 1 snapshot from API patch)
  await page.click('.rail-ico >> nth=0'); // home view (library nav lives there)
  await page.waitForTimeout(600);
  await page.click('text=Agent Library');
  await page.waitForTimeout(900);
  await page.click('.acard:has-text("ToastMaster")');
  await page.waitForTimeout(700);
  await page.click('.ftab:has-text("History")');
  await page.waitForTimeout(800);
  out.histRows = await page.evaluate(() => document.querySelectorAll('.hist-row').length);
  out.histText = await page.evaluate(() => document.querySelector('.hist-row')?.innerText.replace(/\n/g, ' | ').slice(0, 160) || 'none');

  // peek the snapshot
  await page.click('.hist-row .restore.ghost');
  await page.waitForTimeout(400);
  await shot("history");

  // restore → opens edit modal prefilled with old version
  await page.click('.hist-row button.restore:not(.ghost)');
  await page.waitForTimeout(700);
  out.editTitle = await page.evaluate(() => document.querySelector('.modal h3')?.innerText || 'no-edit-modal');
  out.editFields = await page.evaluate(() => ({
    name: document.querySelector('.modal input')?.value,
  }));
  await shot("restore-edit");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
