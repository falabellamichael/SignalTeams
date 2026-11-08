export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(800);

  const crewBtn = await page.$('button:has-text("crew account")');
  if (crewBtn) {
    await crewBtn.click();
    await page.waitForTimeout(400);
  }

  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1500);

  // Open Settings modal via gear button in MeBar
  const gear = await page.$('.mebar button[title="Settings"], button[title="Settings"]');
  if (gear) await gear.click();
  else {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.mebar button')].pop();
      if (b) b.click();
    });
  }
  await page.waitForTimeout(800);

  const themes = ['Tokyo Night', 'Obsidian', 'Warm Theme', 'Daylight'];
  out.foundButtons = [];
  for (const t of themes) {
    const btn = await page.$(`button:has-text("${t}")`);
    if (btn) {
      out.foundButtons.push(t);
      await btn.click();
      await page.waitForTimeout(400);
      const dt = await page.evaluate(() => document.documentElement.dataset.theme);
      out[t] = dt;
    }
  }
  await page.screenshot({ path: 'D:/AgentHive/qa/qa-themes-modal.png' });

  // Switch back to Tokyo Night
  const tn = await page.$('button:has-text("Tokyo Night")');
  if (tn) await tn.click();
  await page.waitForTimeout(300);

  return out;
}
