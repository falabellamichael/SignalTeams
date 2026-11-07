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
  await page.click('text=general');
  await page.waitForTimeout(700);

  // member list → profile modal for Juno
  await page.click('.mrow:has-text("Juno")');
  await page.waitForTimeout(900);
  out.profile = await page.evaluate(() => ({
    title: document.querySelector('.modal h3')?.innerText.replace(/\n/g, ' '),
    agents: [...document.querySelectorAll('.modal .pack-agent b')].map((b) => b.innerText),
    buttons: [...document.querySelectorAll('.modal .mfoot button')].map((b) => b.innerText),
  }));
  await shot("profile-modal");

  // click one of Juno's agents → agent modal
  const ag = await page.$('.modal .pack-agent');
  if (ag) { await ag.click(); await page.waitForTimeout(800); }
  out.agentModal = await page.evaluate(() =>
    document.querySelector('.modal h3')?.innerText || 'none');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // clicking a bot avatar jumps to the agent card
  const botAv = await page.$('.msg:has-text("Hey Mike") .body');
  const hasBot = await page.evaluate(() => {
    const m = [...document.querySelectorAll('.msg')].find((x) =>
      x.querySelector('.author')?.innerText === 'SousChef');
    if (!m) return false;
    m.querySelector('img, .avatar, [style*="cursor"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  });
  await page.waitForTimeout(900);
  out.botOpensAgent = await page.evaluate(() =>
    document.querySelector('.modal h3')?.innerText || 'none');
  await shot("bot-to-agent");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
