export default async function run(page, ui) {
  const out = {};
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-full-${n}.png` });
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

  // 1. open a file
  const py = await page.$('.ws-row:has-text("workspace.py")');
  await py.click();
  await page.waitForTimeout(1200);
  out.open = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.ws-tab').length,
    gutter: document.querySelectorAll('.ce-ln').length,
    tokens: document.querySelectorAll('.ce-pre .t-kw, .ce-pre .t-string, .ce-pre .t-comment, .ce-pre .t-fn, .ce-pre .t-num').length,
    status: document.querySelector('.ce-status')?.innerText,
  }));

  // 2. open a second file → two tabs
  const md = await page.$('.ws-row:has-text("helpers.py")');
  if (md) { await md.click(); await page.waitForTimeout(1000); }
  out.tabs = await page.evaluate(() => document.querySelectorAll('.ws-tab').length);

  // 3. type → dirty
  await page.click('.ce-ta');
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# qa edit\n");
  await page.waitForTimeout(400);
  out.dirty = await page.evaluate(() => ({
    dot: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    unsaved: document.querySelector('.ws-dirty')?.innerText,
    saveEnabled: !document.querySelector('.ws-tabs button.primary')?.disabled,
  }));

  // 4. auto-indent: type a def and press Enter
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\ndef foo():");
  await page.keyboard.press("Enter");
  await page.keyboard.type("pass");
  await page.waitForTimeout(300);
  out.autoIndent = await page.evaluate(() => {
    const v = document.querySelector('.ce-ta').value;
    const i = v.lastIndexOf("def foo():");
    return JSON.stringify(v.slice(i, i + 30));
  });

  // 5. bracket auto-close
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nx = (");
  await page.waitForTimeout(200);
  out.bracket = await page.evaluate(() => {
    const v = document.querySelector('.ce-ta').value;
    return v.slice(-6);
  });

  // 6. find
  await page.keyboard.press("Control+f");
  await page.waitForTimeout(300);
  await page.keyboard.type("def ");
  await page.waitForTimeout(400);
  out.find = await page.evaluate(() => document.querySelector('.ce-count')?.innerText);
  await page.keyboard.press("Escape");

  // 7. save
  await page.click('.ce-ta');
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1500);
  out.saved = await page.evaluate(() => ({
    dot: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    msg: document.querySelector('.ws-msg')?.innerText,
  }));

  // 8. diff
  await page.click('.ws-tabs button:has-text("diff")').catch(() => { });
  await page.waitForTimeout(900);
  out.diff = await page.evaluate(() => ({
    lines: document.querySelectorAll('.ws-diff > div').length,
    adds: document.querySelectorAll('.ws-diff .d-add').length,
    dels: document.querySelectorAll('.ws-diff .d-del').length,
  }));
  await shot("diff");

  // 9. history
  await page.click('.ws-tabs button:has-text("history")').catch(() => { });
  await page.waitForTimeout(800);
  out.history = await page.evaluate(() => document.querySelectorAll('.ws-rev').length);

  // 10. activity
  await page.click('.ws-tabs button:has-text("activity")').catch(() => { });
  await page.waitForTimeout(800);
  out.activity = await page.evaluate(() => document.querySelectorAll('.ws-act').length);

  // 11. access
  await page.click('.ws-tabs button:has-text("access")').catch(() => { });
  await page.waitForTimeout(600);
  out.access = await page.evaluate(() => document.querySelectorAll('.ws-person').length);

  // 12. back to file, screenshot
  await page.click('.ws-tabs button:has-text("file")').catch(() => { });
  await page.waitForTimeout(500);
  await shot("final");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
