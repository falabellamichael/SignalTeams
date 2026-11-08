export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-ws-${n}.png` });
  const out = {};
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });

  await page.waitForTimeout(900);
  // this box has Supabase configured — switch to the local crew account tab
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);
  await shot("home");

  // open the first server
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1500);
  await shot("server");
  out.sidebar = await page.evaluate(() =>
    [...document.querySelectorAll('.side-group')].map((e) => e.innerText.trim()));

  // open a workspace from the sidebar
  const wsRow = await page.$('.ws-nav');
  out.hasWsRow = !!wsRow;
  if (wsRow) {
    await wsRow.click();
    await page.waitForTimeout(1500);
    await shot("workspace");
    out.wsText = await page.evaluate(() => document.querySelector('.ws')?.innerText.slice(0, 900));
    // open the first file
    const row = await page.$('.ws-row');
    if (row) {
      await row.click();
      await page.waitForTimeout(1200);
      await shot("file");
      out.editor = await page.evaluate(() => ({
        head: document.querySelector('.ws-ed-head')?.innerText,
        code: document.querySelector('.ws-code')?.value?.slice(0, 200),
      }));
    }
    // activity tab
    await page.click('.ws-tabs button:has-text("activity")').catch(() => { });
    await page.waitForTimeout(800);
    await shot("activity");
    // access tab
    await page.click('.ws-tabs button:has-text("access")').catch(() => { });
    await page.waitForTimeout(600);
    await shot("access");
  }
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
