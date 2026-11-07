export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa/qa-agenttabs-${n}.png` });
  const out = {};

  await page.waitForTimeout(800);
  await page.click('button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary:has-text("Sign in")');
  await page.waitForTimeout(1500);

  // open the agent library
  await page.click('text=Agent Library').catch(() => {});
  await page.waitForTimeout(1000);
  // click an agent card / library entry
  await page.locator('.acard, .agent-card, [class*="card"]').first().click().catch(() => {});
  await page.waitForTimeout(700);
  await shot("agent-modal");
  out.modal = await page.evaluate(() => !!document.querySelector('.modal'));
  out.tabs = await page.evaluate(() =>
    [...document.querySelectorAll('.modal .tab, .modal .mtab, .modal [class*="tab"]')]
      .map((t) => t.innerText.trim()).filter(Boolean));

  // click each tab and confirm content swaps without errors
  out.tabResults = [];
  for (const name of ["Connect", "Try", "Reviews", "Stats", "History"]) {
    const btn = page.locator(`.modal button, .modal .tab, .modal .mtab`).filter({ hasText: name }).first();
    if (await btn.count()) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
      out.tabResults.push(name + ":" + await page.evaluate(() =>
        document.querySelector('.modal')?.innerText.length > 30));
    }
  }
  await shot("tabs");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
