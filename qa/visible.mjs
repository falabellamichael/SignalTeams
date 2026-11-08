export default async function run(page, ui) {
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

  // make the textarea text visible in red, hide the pre, to see where the caret text actually is
  await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    ta.style.color = "red";
    ta.style.background = "rgba(255,255,255,0.9)";
    document.querySelector('.ce-hl').style.display = "none";
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "D:/AgentHive/qa-ed-textarea-only.png" });

  // now show the pre, hide the textarea text
  await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    ta.style.color = "transparent";
    ta.style.background = "transparent";
    document.querySelector('.ce-hl').style.display = "";
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "D:/AgentHive/qa-ed-pre-only.png" });
  return {};
}
