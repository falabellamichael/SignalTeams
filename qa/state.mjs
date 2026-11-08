export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1500);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(1800);
  const py = await page.$('.ws-row:has-text("workspace.py")');
  await py.click();
  await page.waitForTimeout(1500);

  out.clean = await page.evaluate(() => ({
    savedLabel: document.querySelector('.ws-saved')?.innerText,
    dirtyLabel: document.querySelector('.ws-dirty')?.innerText,
    saveBtnText: document.querySelector('.ws-tabs button.primary, .ws-tabs button:last-of-type')?.innerText,
    saveDisabled: document.querySelector('.ws-tabs button[title*="No changes"]')?.disabled,
    hint: document.querySelector('.ce-hint')?.innerText,
    hintVisible: !!document.querySelector('.ce-hint')?.offsetParent,
    termPlaceholder: document.querySelector('.ws-term input')?.placeholder,
    termInputW: document.querySelector('.ws-term input')?.getBoundingClientRect().width,
    panelW: document.querySelector('.ws-agent')?.getBoundingClientRect().width,
  }));

  // type → dirty
  await page.click('.ce-ta');
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# x\n");
  await page.waitForTimeout(400);
  out.dirty = await page.evaluate(() => ({
    dirtyLabel: document.querySelector('.ws-dirty')?.innerText,
    saveBtnClass: document.querySelector('.ws-tabs button.primary')?.innerText,
    tabDot: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
  }));

  // save
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1500);
  out.afterSave = await page.evaluate(() => ({
    savedLabel: document.querySelector('.ws-saved')?.innerText,
    dirtyLabel: document.querySelector('.ws-dirty')?.innerText,
    tabDot: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    msg: document.querySelector('.ws-msg')?.innerText,
  }));
  return out;
}
