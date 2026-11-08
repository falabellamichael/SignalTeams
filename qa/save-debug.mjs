export default async function run(page, ui) {
  const out = { reqs: [] };
  page.on("request", (r) => {
    if (r.url().includes("/api/workspaces/") && r.method() === "PUT")
      out.reqs.push({ url: r.url(), body: (r.postData() || "").slice(0, 200) });
  });
  page.on("response", async (r) => {
    if (r.url().includes("/api/workspaces/") && r.request().method() === "PUT")
      out.resp = { status: r.status(), body: (await r.text().catch(() => "")).slice(0, 300) };
  });
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });

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
  await page.waitForTimeout(1200);
  await page.click('.ce-ta');
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n# qa save test\n");
  await page.waitForTimeout(400);
  out.beforeSave = await page.evaluate(() => ({
    dirty: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    saveBtnDisabled: document.querySelector('.ws-tabs button.primary')?.disabled,
  }));
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(2000);
  out.afterSave = await page.evaluate(() => ({
    dirty: !!document.querySelector('.ws-tab.on .ws-tab-dot'),
    msg: document.querySelector('.ws-msg')?.innerText,
    err: document.querySelector('.ws-err')?.innerText,
    banner: document.querySelector('.ws-banner')?.innerText,
  }));
  return out;
}
