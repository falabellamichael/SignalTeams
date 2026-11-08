export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-ed-${n}.png` });
  const out = {};
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

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

  // open a python file
  const py = await page.$('.ws-row:has-text("workspace.py")');
  out.foundPy = !!py;
  if (py) {
    await py.click();
    await page.waitForTimeout(1200);
    await shot("editor");
    out.editor = await page.evaluate(() => ({
      hasPre: !!document.querySelector('.ce-pre'),
      hasTa: !!document.querySelector('.ce-ta'),
      tokens: document.querySelectorAll('.ce-pre .t-kw, .ce-pre .t-string, .ce-pre .t-comment').length,
      gutter: document.querySelectorAll('.ce-ln').length,
      status: document.querySelector('.ce-status')?.innerText,
      firstLine: document.querySelector('.ce-pre')?.innerHTML.slice(0, 300),
    }));
  }

  // open a second file → tabs
  const md = await page.$('.ws-row:has-text("helpers.py")');
  if (md) {
    await md.click();
    await page.waitForTimeout(1000);
    out.tabCount = await page.evaluate(() => document.querySelectorAll('.ws-tab').length);
    await shot("tabs");
  }

  // type into the editor → dirty dot
  await page.click('.ce-ta');
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# edited by qa\n");
  await page.waitForTimeout(500);
  out.dirty = await page.evaluate(() => ({
    dot: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    unsaved: document.querySelector('.ws-dirty')?.innerText,
  }));
  await shot("dirty");

  // find bar
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(300);
  await page.keyboard.type("def ");
  await page.waitForTimeout(400);
  out.find = await page.evaluate(() => document.querySelector('.ce-count')?.innerText);
  await shot("find");
  await page.keyboard.press("Escape");

  // save
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1200);
  out.afterSave = await page.evaluate(() => ({
    dot: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    msg: document.querySelector('.ws-msg')?.innerText,
  }));
  await shot("saved");

  // diff tab
  await page.click('.ws-tabs button:has-text("diff")').catch(() => { });
  await page.waitForTimeout(900);
  out.diff = await page.evaluate(() => ({
    lines: document.querySelectorAll('.ws-diff > div').length,
    adds: document.querySelectorAll('.ws-diff .d-add').length,
  }));
  await shot("diff");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
