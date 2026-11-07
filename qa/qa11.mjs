export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};

  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  // library → packs tab
  await page.click('text=Agent Library');
  await page.waitForTimeout(900);
  await page.click('.ftab:has-text("Packs")');
  await page.waitForTimeout(700);
  out.packCards = await page.evaluate(() =>
    [...document.querySelectorAll('.acard')].map((c) => c.innerText.split('\n')[0]));
  await shot("packs-tab");

  // open pack detail
  await page.click('.acard:has-text("Toast Kit")');
  await page.waitForTimeout(800);
  out.packAgents = await page.evaluate(() =>
    [...document.querySelectorAll('.pack-agent b')].map((b) => b.innerText));
  out.benchBtn = await page.evaluate(() =>
    !!document.querySelector('.mfoot .primary'));
  await shot("pack-modal");

  // share the pack to #general
  await page.click('.mfoot button:not(.primary):not(.danger)'); // ↗ Share
  await page.waitForTimeout(800);
  out.shareTitle = await page.evaluate(() => document.querySelector('.modal h3')?.innerText);
  await page.click('.ideopt:has-text("general")');
  await page.waitForTimeout(900);

  // verify embed landed in #general
  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(800);
  await page.click('text=general');
  await page.waitForTimeout(900);
  out.embeds = await page.evaluate(() =>
    [...document.querySelectorAll('.share-card.pack')].map((c) =>
      c.querySelector('.an')?.innerText));
  out.embedCount = await page.evaluate(() =>
    document.querySelector('.share-card.pack .ver')?.innerText);
  await shot("pack-embed");

  // new-pack modal sanity: open, pick an agent, close
  await page.click('.rail-ico >> nth=0');
  await page.waitForTimeout(500);
  await page.click('text=Agent Library');
  await page.waitForTimeout(700);
  await page.click('.ftab:has-text("Packs")');
  await page.waitForTimeout(500);
  await page.click('button.primary:has-text("New pack")');
  await page.waitForTimeout(700);
  await page.fill('.modal input >> nth=0', 'QA Pack');
  await page.click('.pack-pick .pack-agent >> nth=0');
  await page.click('.pack-pick .pack-agent >> nth=1');
  await page.waitForTimeout(300);
  out.createBtn = await page.evaluate(() =>
    document.querySelector('.mfoot .primary')?.innerText);
  await shot("pack-create");
  await page.click('.mfoot .primary');
  await page.waitForTimeout(900);
  out.packCardsAfter = await page.evaluate(() =>
    [...document.querySelectorAll('.acard')].map((c) => c.innerText.split('\n')[0]));

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
