export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-ws-${n}.png` });
  const out = {};
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

  // link a folder via the Workspaces "+" in the sidebar
  await page.click('.side-group:has-text("Workspaces") .add').catch((e) => { out.addErr = String(e); });
  await page.waitForTimeout(900);
  await shot("modal");
  out.modalText = await page.evaluate(() => document.querySelector('.modal')?.innerText.slice(0, 500));

  await page.fill('.modal input >> nth=0', 'AgentHive Core');
  await page.fill('.modal input >> nth=1', 'D:\\AgentHive\\backend\\app');
  await page.waitForTimeout(200);
  await page.click('.modal button.primary');
  await page.waitForTimeout(2000);
  await shot("workspace");
  out.wsText = await page.evaluate(() => document.querySelector('.ws')?.innerText.slice(0, 1200));

  // open a file
  const rows = await page.$$('.ws-row');
  out.rowCount = rows.length;
  const py = await page.$('.ws-row:has-text("workspace.py")');
  if (py) {
    await py.click();
    await page.waitForTimeout(1200);
    await shot("file");
    out.editor = await page.evaluate(() => ({
      head: document.querySelector('.ws-ed-head')?.innerText,
      code: document.querySelector('.ws-code')?.value?.slice(0, 160),
    }));
  }
  await page.click('.ws-tabs button:has-text("activity")').catch(() => { });
  await page.waitForTimeout(800);
  await shot("activity");
  await page.click('.ws-tabs button:has-text("access")').catch(() => { });
  await page.waitForTimeout(600);
  await shot("access");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
