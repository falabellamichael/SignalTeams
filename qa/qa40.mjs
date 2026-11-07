export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1200);

  // /poll in #general via the real composer
  const composer = page.locator('textarea, .composer input, input[placeholder^="Message"]').last();
  await composer.fill('/poll which should bench tonight: SousChef or LoreKeeper?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600);
  out.poll = await page.evaluate(() => {
    const texts = [...document.querySelectorAll('.msg')].map((m) => m.innerText);
    const pm = texts.find((t) => t.includes('Poll:')) || null;
    const reacts = [...document.querySelectorAll('.msg')].at(-1)
      ? [...document.querySelectorAll('.msg')].at(-1).querySelectorAll('.reaction').length : 0;
    return { found: pm ? pm.slice(0, 90) : null, seededReactions: reacts };
  });
  await page.screenshot({ path: 'D:/AgentHive/qa-poll.png' });

  // /huddle in #agent-drops
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('agent-drops'))?.click();
  });
  await page.waitForTimeout(1000);
  const c2 = page.locator('textarea, .composer input, input[placeholder^="Message"]').last();
  await c2.fill('/huddle');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  out.huddleTyping = await page.evaluate(() =>
    document.querySelector('.typing, .typer, .typeline')?.innerText ?? document.body.innerText.match(/is typing/g)?.length ?? 0);
  return out;
}
