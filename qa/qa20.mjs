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

  // edit agent-drops → pick residents
  await page.hover('.nav-item:has-text("agent-drops")');
  await page.click('.nav-item:has-text("agent-drops") .ch-gear');
  await page.waitForTimeout(700);
  out.pickerCount = await page.evaluate(() =>
    document.querySelectorAll('.modal .pack-agent').length);
  await shot("roster-pick");
  // pick the first two agents
  await page.click('.modal .pack-agent >> nth=0');
  await page.click('.modal .pack-agent >> nth=1');
  await page.click('.modal button.primary');
  await page.waitForTimeout(900);

  // open the channel → roster strip
  await page.click('text=agent-drops');
  await page.waitForTimeout(800);
  out.roster = await page.evaluate(() =>
    [...document.querySelectorAll('.r-chip')].map((c) => c.innerText));
  await shot("roster-strip");

  // click a resident chip → agent modal
  if (out.roster.length) {
    await page.click('.r-chip >> nth=0');
    await page.waitForTimeout(800);
    out.agentModal = await page.evaluate(() =>
      document.querySelector('.modal h3')?.innerText || 'none');
    await shot("roster-agent");
  }
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
